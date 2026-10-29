import Foundation

/// One open account scope. Every stored property is confined to `engine.control`.
final class SlaxOfflineSession {
  struct Entry { var manifest: SlaxOfflineManifest?; var contentSize: Int64? }
  final class Job {
    let task: SlaxOfflineTask
    let work: SlaxOfflineWork
    var attempts = 0
    var reported = false
    init(task: SlaxOfflineTask, work: SlaxOfflineWork) { self.task = task; self.work = work }
  }
  final class Request {
    let id: String
    let key: String
    let work: SlaxOfflineWork
    let reply: SlaxOfflineReply
    init(id: String, key: String, work: SlaxOfflineWork, reply: SlaxOfflineReply) { self.id = id; self.key = key; self.work = work; self.reply = reply }
  }
  final class Waiter {
    var done = false
    let accept: ((generation: Int, token: String)) -> Bool
    let deliver: ((generation: Int, token: String)?) -> Void
    init(accept: @escaping ((generation: Int, token: String)) -> Bool, deliver: @escaping ((generation: Int, token: String)?) -> Void) { self.accept = accept; self.deliver = deliver }
  }

  let scope: SlaxOfflineScope
  let lease: SlaxStorageLease
  unowned let engine: SlaxOfflineEngine
  let layout: SlaxOfflineLayout
  var opened = false
  var suspended = false
  var closed = false
  var online = true
  var downloadImages = true
  var credential: (generation: Int, token: String)?
  var revision: Double = -.infinity
  var tasks: [String: SlaxOfflineTask] = [:]
  var order: [String] = []
  var entries: [String: Entry] = [:]
  var loading = Set<String>()
  var jobs: [String: Job] = [:]
  var imageJobs: [String: SlaxOfflineWork] = [:]
  var writers: [String: [UUID: SlaxOfflineWork]] = [:]
  var requests: [String: Request] = [:]
  var protections: [String: String] = [:]
  var explicit = Set<String>()
  var reported: [String: String] = [:]
  var pending: [String: [String: Any]] = [:]
  var pendingOrder: [String] = []
  var flushScheduled = false
  var lastEmit: DispatchTime?
  var wake: DispatchWorkItem?
  var wakeAt: Int64 = .max
  var pumpScheduled = false
  var waiters: [Waiter] = []
  private let keyLock = NSLock()
  private var keyLocks: [String: NSLock] = [:]

  init(scope: SlaxOfflineScope, lease: SlaxStorageLease, engine: SlaxOfflineEngine) {
    self.scope = scope; self.lease = lease; self.engine = engine; layout = SlaxOfflineLayout(scopeId: scope.scopeId)
  }
  func store(_ lease: SlaxStorageLease) -> SlaxFileStore { SlaxFileStore(root: scope.root, pdfRoot: scope.root, lease: lease) }
  func protected(_ key: String) -> Bool { protections.values.contains(key) }
  /// Serializes PDF part mutations of one key across PDF workers.
  func locked<T>(_ key: String, _ work: () throws -> T) rethrows -> T {
    keyLock.lock(); let lock = keyLocks[key] ?? NSLock(); keyLocks[key] = lock; keyLock.unlock()
    lock.lock(); defer { lock.unlock() }
    return try work()
  }

  /// Runs file work on the IO pool under the session lease and returns to the control queue.
  func io<T>(_ work: @escaping (SlaxFileStore) throws -> T, _ done: @escaping (Result<T, SlaxOfflineError>) -> Void) {
    let store = store(lease)
    engine.io.addOperation {
      let result: Result<T, SlaxOfflineError>
      do { result = .success(try work(store)) } catch { result = .failure(.from(error)) }
      self.engine.control.async { done(result) }
    }
  }
  /// Serialized commit for `key`; eviction and clearing cancel the work before deleting files.
  func commit(_ key: String, work: SlaxOfflineWork? = nil, _ body: @escaping (SlaxFileStore) throws -> Void, _ done: @escaping (Result<Void, SlaxOfflineError>) -> Void = { _ in }) {
    let work = work ?? SlaxOfflineWork(lease: lease.child()), id = UUID()
    writers[key, default: [:]][id] = work
    let store = store(work.lease)
    engine.commits.addOperation {
      let result: Result<Void, SlaxOfflineError>
      do { try work.check(); try body(store); result = .success(()) } catch { result = .failure(.from(error)) }
      self.engine.control.async {
        self.writers[key]?.removeValue(forKey: id); if self.writers[key]?.isEmpty == true { self.writers.removeValue(forKey: key) }
        done(result)
      }
    }
  }

  // MARK: Lifecycle

  func start(_ reply: SlaxOfflineReply) {
    let layout = layout
    io({ store -> [String: Any] in try Self.migrate(store, layout) }) { result in
      switch result {
      case .success(let value): self.opened = true; self.engine.publishReadable(self); reply.resolve(value); self.loadEntries(Array(self.tasks.keys)); self.schedulePump()
      case .failure(let error): reply.fail(error)
      }
    }
  }
  /// One-time transition to the engine layout; idempotent until JavaScript commits the marker.
  static func migrate(_ store: SlaxFileStore, _ layout: SlaxOfflineLayout) throws -> [String: Any] {
    if let data = try store.readMarker(), let marker = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], SlaxOfflineJson.int(marker["layout"]) == 2 {
      return ["adopted": [String](), "dropped": [String](), "migrationPending": false]
    }
    var dropped = Set<String>(), adopted: [String] = []
    _ = try store.remove("pdf/v1")
    _ = try? store.purgeStaging("pdf")
    for key in try store.purgeStaging("bookmark") where SlaxOfflineTask.validKey(key) { dropped.insert(key) }
    for key in try store.directories("bookmark") where SlaxOfflineTask.validKey(key) && !key.hasPrefix("avatar-") {
      do {
        if let manifest = try SlaxOfflineLayout.readManifest(store, key) {
          let size = try layout.contentSize(store, key, kind: manifest.kind)
          if manifest.size > 0, size == manifest.size { adopted.append(key) } else { dropped.insert(key) }
          continue
        }
        guard let size = try store.size(SlaxOfflineLayout.content(key)), (1...Int64(SlaxFileStore.articleLimit)).contains(size),
          let bytes = try store.read(SlaxOfflineLayout.content(key), limit: SlaxFileStore.articleLimit) else { dropped.insert(key); continue }
        let images = SlaxOfflineHtml.imageUrls(Self.decode(bytes)).map { SlaxOfflineImage(url: $0, state: "pending", attempts: 0, retryAt: 0) }
        try SlaxOfflineLayout.writeManifest(store, key, SlaxOfflineManifest(id: "", owner: nil, kind: "article", version: nil, size: Int64(bytes.count), images: images, retry: nil))
        adopted.append(key); dropped.remove(key)
      } catch SlaxFileStoreError.revoked { throw SlaxFileStoreError.revoked } catch { dropped.insert(key) }
    }
    let adoptedSet = Set(adopted)
    return ["adopted": adopted, "dropped": dropped.subtracting(adoptedSet).sorted(), "migrationPending": true]
  }
  static func decode(_ bytes: Data) -> String {
    var text = String(decoding: bytes, as: UTF8.self)
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return text
  }
  func commitMigration(_ reply: SlaxOfflineReply) {
    commit("", { store in try store.writeMarker(try JSONSerialization.data(withJSONObject: ["layout": 2])) }) { result in
      switch result { case .success: reply.resolve(nil); case .failure(let error): reply.fail(error) }
    }
  }
  private func cancelActive(_ error: SlaxOfflineError, writers includeWriters: Bool) {
    jobs.values.forEach { $0.work.cancel() }; jobs.removeAll()
    imageJobs.values.forEach { $0.cancel() }; imageJobs.removeAll()
    if includeWriters { writers.values.forEach { $0.values.forEach { $0.cancel() } } }
    let active = Array(requests.values); requests.removeAll()
    active.forEach { $0.work.cancel(); $0.reply.fail(error) }
    flushWaiters()
    wake?.cancel(); wake = nil; wakeAt = .max
  }
  func suspend(_ reply: SlaxOfflineReply) {
    suspended = true; cancelActive(.cancelled, writers: false)
    engine.commits.addBarrierBlock { reply.resolve(nil) }
  }
  func resume() { guard suspended else { return }; suspended = false; schedulePump() }
  func shutdown(_ error: SlaxOfflineError) {
    guard !closed else { return }
    closed = true; suspended = true; lease.cancel(); engine.unpublishReadable(self); cancelActive(error, writers: true)
    pending.removeAll(); pendingOrder.removeAll()
  }

  // MARK: Inputs

  func setCredential(_ raw: [String: Any]?) {
    guard let raw else { credential = nil; return }
    guard let generation = SlaxOfflineJson.int(raw["generation"]), let token = raw["token"] as? String, !token.isEmpty, token.utf8.count <= 16384,
      !token.unicodeScalars.contains(where: { $0.value < 33 || $0.value == 127 }) else { credential = nil; return }
    credential = (Int(generation), token)
    let ready = waiters; waiters = []
    for waiter in ready where !waiter.done {
      if waiter.accept(credential!) { waiter.done = true; waiter.deliver(credential) } else { waiters.append(waiter) }
    }
    schedulePump()
  }
  func setConditions(_ raw: [String: Any]) {
    let nextOnline = raw["online"] as? Bool ?? online, nextImages = raw["downloadImages"] as? Bool ?? downloadImages
    if !nextOnline && online { jobs.values.forEach { $0.work.cancel() }; jobs.removeAll() }
    if !nextOnline || !nextImages { imageJobs.values.forEach { $0.cancel() }; imageJobs.removeAll() }
    online = nextOnline; downloadImages = nextImages
    schedulePump()
  }
  func awaitCredential(timeout: TimeInterval, accept: @escaping ((generation: Int, token: String)) -> Bool, _ deliver: @escaping ((generation: Int, token: String)?) -> Void) {
    if let credential, accept(credential) { deliver(credential); return }
    let waiter = Waiter(accept: accept, deliver: deliver); waiters.append(waiter)
    engine.control.asyncAfter(deadline: .now() + timeout) { [weak waiter] in
      guard let waiter, !waiter.done else { return }
      waiter.done = true; self.waiters.removeAll { $0 === waiter }; waiter.deliver(nil)
    }
  }
  func flushWaiters() { let pending = waiters; waiters = []; pending.forEach { if !$0.done { $0.done = true; $0.deliver(nil) } } }
  /// 401 for `generation`: forget the token and ask JavaScript once for a newer generation.
  func rejectCredential(_ generation: Int) {
    guard credential?.generation == generation else { return }
    credential = nil
    engine.emit("onCredentialRejected", ["owner": scope.owner, "generation": generation])
  }
  func protect(_ key: String, token: String) {
    guard SlaxOfflineTask.validKey(key), protections.count < 1024 else { return }
    protections[token] = key
    if let task = tasks[key], let retry = entries[key]?.manifest?.retry, retry.version == task.version, !retry.denied { explicit.insert(key); schedulePump() }
  }
  func release(_ token: String) { protections.removeValue(forKey: token) }

  // MARK: Foreground requests

  func register(_ id: String, key: String, reply: SlaxOfflineReply) -> Request? {
    guard id.utf8.count <= 128, !id.isEmpty, !id.unicodeScalars.contains(where: { $0.value < 33 || $0.value == 127 }) else { reply.fail(.invalid); return nil }
    if suspended { reply.fail(.cancelled); return nil }
    cancelRequest(id, .cancelled)
    let request = Request(id: id, key: key, work: SlaxOfflineWork(lease: lease.child()), reply: reply)
    requests[id] = request; return request
  }
  func finish(_ request: Request, _ result: Result<Any?, SlaxOfflineError>) {
    if requests[request.id] === request { requests.removeValue(forKey: request.id) }
    switch result { case .success(let value): request.reply.resolve(value); case .failure(let error): request.reply.fail(error) }
  }
  func cancelRequest(_ id: String, _ error: SlaxOfflineError) {
    guard let request = requests.removeValue(forKey: id) else { return }
    request.work.cancel(); request.reply.fail(error)
  }
}
