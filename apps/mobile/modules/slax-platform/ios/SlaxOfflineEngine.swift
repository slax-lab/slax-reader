import Foundation

/// Settles one JavaScript promise at most once, from any queue.
final class SlaxOfflineReply {
  private let lock = NSLock()
  private var settled = false
  private let resolver: (Any?) -> Void
  private let failer: (SlaxOfflineError) -> Void
  init(resolve: @escaping (Any?) -> Void, reject: @escaping (String, String) -> Void) { resolver = resolve; failer = { reject($0.code, $0.message) } }
  /// Native callers (the PDF scheme handlers) that need the structured error.
  init(_ done: @escaping (Result<Any?, SlaxOfflineError>) -> Void) { resolver = { done(.success($0)) }; failer = { done(.failure($0)) } }
  private func settle() -> Bool { lock.lock(); defer { lock.unlock() }; if settled { return false }; settled = true; return true }
  var isSettled: Bool { lock.lock(); defer { lock.unlock() }; return settled }
  func resolve(_ value: Any?) { if settle() { resolver(value) } }
  func fail(_ error: SlaxOfflineError) { if settle() { failer(error) } }
}

struct SlaxOfflineEnvironment {
  var root: (String) throws -> URL
  var registry: () throws -> SlaxImageRegistry
  var allowHTTP: Bool
  var random: () -> Double = { Double.random(in: 0...1) }
  static var standard: SlaxOfflineEnvironment {
    #if DEBUG
    let allowHTTP = true
    #else
    let allowHTTP = false
    #endif
    return SlaxOfflineEnvironment(root: { try SlaxImageResources.root($0).0 }, registry: { try SlaxImageResources.registry() }, allowHTTP: allowHTTP)
  }
}

/// Native offline acquisition. All session state is owned by `control`; network and file work run on the queues below.
final class SlaxOfflineEngine {
  static let shared = SlaxOfflineEngine(environment: .standard)
  let control = DispatchQueue(label: "SlaxOfflineEngine.control", qos: .utility)
  let io = SlaxOfflineEngine.queue("SlaxOfflineEngine.io", 4)
  let commits = SlaxOfflineEngine.queue("SlaxOfflineEngine.commit", 1)
  let cpu = SlaxOfflineEngine.queue("SlaxOfflineEngine.cpu", 2)
  let images = SlaxOfflineEngine.queue("SlaxOfflineEngine.images", 2)
  let pdf = SlaxOfflineEngine.queue("SlaxOfflineEngine.pdf", 6)
  /// Committed-copy reads for an open Reader; never shared with acquisition, migration or entry loading.
  let foreground = SlaxOfflineEngine.queue("SlaxOfflineEngine.foreground", 2, qos: .userInitiated)
  /// Network work of an open PDF Reader (metadata, missing byte ranges); never waits behind background PDF acquisition on `pdf`.
  let pdfForeground = SlaxOfflineEngine.queue("SlaxOfflineEngine.pdfForeground", 4, qos: .userInitiated)
  let http = SlaxOfflineHttp()
  let environment: SlaxOfflineEnvironment
  private var sessions: [String: SlaxOfflineSession] = [:]
  private let emitLock = NSLock()
  private var emitter: (token: UUID, send: (String, [String: Any]) -> Void)?
  private var observer: UUID?
  private let readableLock = NSLock()
  private var readable: [String: SlaxOfflineSession] = [:]

  private static func queue(_ name: String, _ width: Int, qos: QualityOfService = .utility) -> OperationQueue {
    let queue = OperationQueue(); queue.name = name; queue.qualityOfService = qos; queue.maxConcurrentOperationCount = width; return queue
  }
  init(environment: SlaxOfflineEnvironment) {
    self.environment = environment
    observer = SlaxStorageOwner.observe { [weak self] _ in self?.control.async { self?.revalidate() } }
  }
  deinit { if let observer { SlaxStorageOwner.unobserve(observer) } }

  func attach(_ send: @escaping (String, [String: Any]) -> Void) -> UUID {
    emitLock.lock(); defer { emitLock.unlock() }
    let token = UUID(); emitter = (token, send); return token
  }
  func detach(_ token: UUID) {
    emitLock.lock(); let current = emitter?.token == token; if current { emitter = nil }; emitLock.unlock()
    if current { control.async { self.sessions.values.forEach { $0.shutdown(.cancelled) }; self.sessions.removeAll() } }
  }
  func emit(_ name: String, _ body: [String: Any]) {
    emitLock.lock(); let send = emitter?.send; emitLock.unlock()
    send?(name, body)
  }
  private func revalidate() {
    for (owner, session) in sessions where (try? session.lease.check()) == nil { session.shutdown(.revoked); sessions.removeValue(forKey: owner) }
  }
  private func on(_ owner: String, _ reply: SlaxOfflineReply? = nil, foreground: Bool = false, _ work: @escaping (SlaxOfflineSession) -> Void) {
    let body = {
      guard let session = self.sessions[owner], !session.closed else { reply?.fail(.revoked); return }
      work(session)
    }
    if foreground { control.async(qos: .userInitiated, flags: .enforceQoS, execute: body) } else { control.async(execute: body) }
  }
  /// A started session serves committed-copy reads without passing through the control queue; its lease still gates every read.
  func publishReadable(_ session: SlaxOfflineSession) { readableLock.lock(); readable[session.scope.owner] = session; readableLock.unlock() }
  func unpublishReadable(_ session: SlaxOfflineSession) {
    readableLock.lock(); if readable[session.scope.owner] === session { readable.removeValue(forKey: session.scope.owner) }; readableLock.unlock()
  }
  private func readableSession(_ owner: String) -> SlaxOfflineSession? { readableLock.lock(); defer { readableLock.unlock() }; return readable[owner] }

  func open(_ raw: [String: Any], reply: SlaxOfflineReply) {
    control.async {
      let scope: SlaxOfflineScope
      do { scope = try SlaxOfflineScope(raw, root: self.environment.root, allowHTTP: self.environment.allowHTTP) } catch { reply.fail(.from(error)); return }
      self.sessions.removeValue(forKey: scope.owner)?.shutdown(.cancelled)
      guard let lease = try? SlaxStorageOwner.capture(scope.owner) else { reply.fail(.revoked); return }
      let session = SlaxOfflineSession(scope: scope, lease: lease, engine: self)
      self.sessions[scope.owner] = session
      session.start(reply)
    }
  }
  func commitMigration(_ owner: String, reply: SlaxOfflineReply) { on(owner, reply) { $0.commitMigration(reply) } }
  func suspend(_ owner: String, reply: SlaxOfflineReply) {
    control.async {
      guard let session = self.sessions[owner], !session.closed else { reply.resolve(nil); return }
      session.suspend(reply)
    }
  }
  func resume(_ owner: String) { on(owner) { $0.resume() } }
  func close(_ owner: String, reply: SlaxOfflineReply) {
    control.async {
      guard let session = self.sessions.removeValue(forKey: owner) else { reply.resolve(nil); return }
      session.shutdown(.cancelled)
      self.commits.addBarrierBlock { reply.resolve(nil) }
    }
  }
  func setCredential(_ owner: String, _ raw: [String: Any]?) { on(owner) { $0.setCredential(raw) } }
  func setConditions(_ owner: String, _ raw: [String: Any]) { on(owner) { $0.setConditions(raw) } }
  func applyPlan(_ owner: String, _ raw: [String: Any]) { on(owner) { $0.apply(raw) } }
  func evict(_ owner: String, _ keys: [String], reply: SlaxOfflineReply) { on(owner, reply) { $0.evict(keys, reply: reply) } }
  func protect(_ owner: String, _ key: String) -> String {
    let token = UUID().uuidString
    on(owner) { $0.protect(key, token: token) }
    return token
  }
  func release(_ owner: String, _ token: String) { on(owner) { $0.release(token) } }
  func readArticle(_ owner: String, _ key: String, reply: SlaxOfflineReply) {
    if let session = readableSession(owner) { session.readArticle(key, reply: reply); return }
    on(owner, reply, foreground: true) { $0.readArticle(key, reply: reply) }
  }
  func fetchArticle(_ owner: String, _ raw: [String: Any], reply: SlaxOfflineReply) {
    if let session = readableSession(owner) { session.fetchArticle(raw, reply: reply); return }
    on(owner, reply, foreground: true) { $0.fetchArticle(raw, reply: reply) }
  }
  /// Hands foreground request bookkeeping to the control queue ahead of utility-priority work items.
  func foregroundControl(_ work: @escaping () -> Void) { control.async(qos: .userInitiated, flags: .enforceQoS, execute: work) }
  func pdfMetadata(_ owner: String, _ raw: [String: Any], reply: SlaxOfflineReply) {
    if let session = readableSession(owner) { session.pdfMetadata(raw, reply: reply); return }
    on(owner, reply, foreground: true) { $0.pdfMetadata(raw, reply: reply) }
  }
  /// Byte range for an open PDF Reader host of `owner`; served natively to its page, never through JavaScript.
  func servePdfRange(_ owner: String, _ range: SlaxPdfRange, requestId: String, reply: SlaxOfflineReply) {
    guard let session = readableSession(owner) else { reply.fail(.revoked); return }
    session.servePdfRange(range, requestId: requestId, reply: reply)
  }
  func pdfStatus(_ owner: String, _ key: String, reply: SlaxOfflineReply) { on(owner, reply) { $0.pdfStatus(key, reply: reply) } }
  func cancel(_ owner: String, _ requestId: String) { on(owner) { $0.cancelRequest(requestId, .cancelled) } }
  func usage(_ owner: String, _ keys: [String], reply: SlaxOfflineReply) { on(owner, reply) { $0.usage(keys, reply: reply) } }
  func clear(_ owner: String, _ keys: [String], _ categories: [String], reply: SlaxOfflineReply) { on(owner, reply) { $0.clear(keys, categories, reply: reply) } }
}
