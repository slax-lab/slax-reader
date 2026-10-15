import Foundation
import WebKit

protocol SlaxResourceTask: AnyObject { func cancel() }

final class SlaxWebImageTask: SlaxResourceTask {
  private static let budget = NSLock()
  private static var pending = 0
  private static let workers: OperationQueue = {
    let queue = OperationQueue(); queue.name = "SlaxWebImage"; queue.qualityOfService = .userInitiated; queue.maxConcurrentOperationCount = 3; return queue
  }()
  private let task: WKURLSchemeTask
  private let original: URL
  private let root: URL
  private let key: String
  private let owner: String?
  private let policy: SlaxReaderSecurity
  private let allowsNetwork: Bool
  private let hasOwnership: () -> Bool
  private let done: () -> Void
  private let state = NSLock()
  private var cancelled = false
  private var consumer: SlaxImageRegistry.Consumer?

  init(task: WKURLSchemeTask, original: URL, root: URL, key: String, owner: String?, policy: SlaxReaderSecurity, allowsNetwork: Bool, hasOwnership: @escaping () -> Bool, done: @escaping () -> Void) {
    self.task = task; self.original = original; self.root = root; self.key = key; self.owner = owner; self.policy = policy
    self.allowsNetwork = allowsNetwork; self.hasOwnership = hasOwnership; self.done = done
  }
  private func check() throws {
    state.lock(); let cancelled = cancelled; state.unlock()
    if cancelled { throw URLError(.cancelled) }
  }
  private func active() -> Bool {
    guard (try? check()) != nil else { return false }
    if !hasOwnership() { cancel(); done(); return false }
    return true
  }
  func start() {
    guard active() else { return }
    Self.budget.lock()
    guard Self.pending < 128 else { Self.budget.unlock(); task.didFailWithError(URLError(.resourceUnavailable)); done(); return }
    Self.pending += 1; Self.budget.unlock()
    Self.workers.addOperation {
      defer { Self.budget.lock(); Self.pending -= 1; Self.budget.unlock() }
      self.run()
    }
  }
  func cancel() {
    state.lock(); cancelled = true; let consumer = consumer; self.consumer = nil; state.unlock()
    consumer?.close()
  }
  private func attach(_ value: SlaxImageRegistry.Consumer) throws {
    state.lock()
    if cancelled { state.unlock(); value.close(); throw URLError(.cancelled) }
    consumer = value; state.unlock()
  }
  private func release() {
    state.lock(); let consumer = consumer; self.consumer = nil; state.unlock(); consumer?.close()
  }
  private func deliver(_ work: @escaping () -> Void) -> Bool {
    let completed = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      defer { completed.signal() }
      guard self.active() else { return }; work()
    }
    completed.wait()
    return (try? check()) != nil
  }
  private func run() {
    defer { release() }
    var responseStarted = false
    do {
      try check()
      let paths = SlaxImageResources.paths(root: root, key: key, original: original)
      for file in paths {
        try check()
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path), attributes[.type] as? FileAttributeType == .typeRegular,
          let size = attributes[.size] as? NSNumber, (1...SlaxImageRegistry.maxBytes).contains(size.int64Value) else { continue }
        do {
          let input = try FileHandle(forReadingFrom: file); defer { try? input.close() }
          guard deliver({ self.task.didReceive(URLResponse(url: self.task.request.url!, mimeType: Self.mime(file.pathExtension), expectedContentLength: size.intValue, textEncodingName: nil)) }) else { return }
          responseStarted = true
          while true {
            try check(); let data = try input.read(upToCount: SlaxImageRegistry.chunkBytes) ?? Data(); try check()
            if data.isEmpty { break }; guard deliver({self.task.didReceive(data)}) else { return }
          }
          _ = deliver {self.task.didFinish(); self.done()}; return
        } catch { if responseStarted { throw error } }
      }
      guard allowsNetwork, let owner else { throw URLError(.notConnectedToInternet) }
      let consumer = try SlaxImageResources.registry().acquire(owner: owner, url: original, policy: policy, strict: false)
      try attach(consumer)
      let resource = try consumer.wait(); try check()
      guard deliver({}) else { return }
      if let target = paths.first, Self.downloadImagesEnabled() {
        do {
          _ = try consumer.persist(root: root, relative: String(target.path.dropFirst(root.path.count + 1))) { try self.check() }
        } catch { try check(); try consumer.check() }
      }
      guard deliver({ self.task.didReceive(URLResponse(url: self.task.request.url!, mimeType: resource.mime ?? "image/jpeg", expectedContentLength: Int(resource.size), textEncodingName: nil)) }) else { return }
      responseStarted = true
      try consumer.read { bytes in
        try self.check(); guard self.deliver({self.task.didReceive(bytes)}) else { throw URLError(.cancelled) }
      }
      _ = deliver {self.task.didFinish(); self.done()}
    } catch { _ = deliver {self.task.didFailWithError(URLError(.resourceUnavailable)); self.done()} }
  }
  private static func downloadImagesEnabled() -> Bool {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.slax.reader"),
      let data = try? Data(contentsOf: root.appendingPathComponent("slax.preferences.v1.json")),
      let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let values = snapshot["values"] as? [String: Any] else { return true }
    return (values["download_images"] as? NSNumber)?.intValue != 0
  }
  private static func mime(_ ext: String) -> String {
    switch ext { case "png": "image/png"; case "gif": "image/gif"; case "webp": "image/webp"; case "svg": "image/svg+xml"; case "avif": "image/avif"; default: "image/jpeg" }
  }
}
