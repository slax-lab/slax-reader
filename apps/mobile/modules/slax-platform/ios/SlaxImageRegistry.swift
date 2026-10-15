import Foundation

struct SlaxImageResource { let file: URL; let mime: String?; let size: Int64 }
struct SlaxImageFailure: Error {
  var status = 0
  var retryAfter: String?
  var terminal = false
}

final class SlaxImageRegistry {
  static let maxBytes: Int64 = 20 * 1024 * 1024
  static let totalBytes: Int64 = 60 * 1024 * 1024
  static let chunkBytes = 64 * 1024
  private let directory: URL
  private let lock = NSRecursiveLock()
  private var jobs: [Key: Job] = [:]
  private var retained: [UUID: Job] = [:]
  private var running: [UUID: Job] = [:]
  private var destinations: [String: Int] = [:]
  private var reserved: Int64 = 0
  private var closed = false
  private let drained = DispatchGroup()
  private let workers: OperationQueue = {
    let queue = OperationQueue(); queue.name = "SlaxImageResource"; queue.qualityOfService = .utility; queue.maxConcurrentOperationCount = 3; return queue
  }()
  private struct Key: Hashable { let owner: String; let hosts: [String]; let proxies: [String]; let url: String }
  private final class Job: NSObject, URLSessionDataDelegate, URLSessionDownloadDelegate {
    let id = UUID()
    let key: Key
    let original: URL
    let policy: SlaxReaderSecurity
    let lease: SlaxStorageLease
    weak var registry: SlaxImageRegistry?
    var consumers: [UUID: Consumer] = [:]
    var state = "queued"
    var reservation: Int64 = 0
    var session: URLSession?
    var task: URLSessionTask?
    var result: SlaxImageResource?
    var error: Error?
    var advertised: Int64?
    var mime: String?
    var destination: String?
    var redirects = 0
    var expiry: DispatchWorkItem?
    init(key: Key, original: URL, policy: SlaxReaderSecurity, lease: SlaxStorageLease, registry: SlaxImageRegistry) {
      self.key = key; self.original = original; self.policy = policy; self.lease = lease; self.registry = registry
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
      guard let registry else { completionHandler(nil); return }
      registry.redirect(self, request: request, completionHandler: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
      completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
      guard let registry else { completionHandler(.cancel); return }
      registry.response(self, response: response, completionHandler: completionHandler)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didBecome downloadTask: URLSessionDownloadTask) {
      guard let registry else { downloadTask.cancel(); return }
      registry.lock.lock(); task = downloadTask
      let active = (try? registry.check(self)) != nil; registry.lock.unlock()
      if !active { downloadTask.cancel() }
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
      guard let registry else { downloadTask.cancel(); return }
      registry.progress(self, received: totalBytesWritten, expected: totalBytesExpectedToWrite)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) { registry?.downloaded(self, location: location) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
      if let registry {
        registry.lock.lock(); if self.error == nil { self.error = error }; registry.lock.unlock()
      }
      session.finishTasksAndInvalidate()
    }
    func urlSession(_ session: URLSession, didBecomeInvalidWithError error: Error?) { registry?.finished(self, error: error) }
  }
  final class Consumer {
    let id = UUID()
    private let registry: SlaxImageRegistry
    private let job: AnyObject
    private let lease: SlaxStorageLease
    private let strict: Bool
    private let condition = NSCondition()
    private var result: Result<SlaxImageResource, Error>?
    fileprivate init(registry: SlaxImageRegistry, job: AnyObject, lease: SlaxStorageLease, strict: Bool) { self.registry = registry; self.job = job; self.lease = lease; self.strict = strict }
    fileprivate func ready(_ resource: SlaxImageResource?, error: Error?) {
      condition.lock(); defer { condition.unlock() }
      guard result == nil else { return }
      if let error { result = .failure(error) } else if let resource { result = .success(resource) }
      condition.broadcast()
    }
    func wait() throws -> SlaxImageResource {
      condition.lock(); while result == nil { condition.wait() }; let result = result!; condition.unlock()
      try lease.check(); let resource = try result.get()
      guard !strict || resource.mime?.hasPrefix("image/") == true else { throw SlaxImageFailure(terminal: true) }
      return resource
    }
    func persist(root: URL, relative: String, beforeCommit: () throws -> Void = {}) throws -> String {
      let parts = relative.components(separatedBy: "/")
      guard parts.count >= 4, parts[0] == "bookmark", parts[2] == "images" else { throw SlaxFileStoreError.invalid }
      let resource = try wait(), input = try FileHandle(forReadingFrom: resource.file); defer { try? input.close() }
      return try SlaxFileStore(root: root, pdfRoot: root, lease: lease).writeStream(relative, input: input, expectedBytes: resource.size, beforeCommit: beforeCommit)
    }
    func read(_ consume: (Data) throws -> Void) throws {
      let resource = try wait(), input = try FileHandle(forReadingFrom: resource.file); defer { try? input.close() }
      while true {
        try lease.check(); let bytes = try input.read(upToCount: SlaxImageRegistry.chunkBytes) ?? Data(); try lease.check()
        if bytes.isEmpty { return }; try consume(bytes)
      }
    }
    func check() throws { try lease.check() }
    func close() { lease.cancel(); ready(nil, error: SlaxImageFailure()); registry.detach(job as! Job, consumer: self) }
  }
  init(directory: URL) { self.directory = directory }
  func acquire(owner: String, url: URL, policy: SlaxReaderSecurity, strict: Bool = true) throws -> Consumer {
    let lease = try SlaxStorageOwner.capture(owner)
    guard let original = policy.imageOriginal(url) else { throw SlaxImageFailure(terminal: true) }
    let key = Key(owner: owner, hosts: policy.protectedHosts, proxies: policy.imageProxyOrigins.sorted(), url: original.absoluteString)
    lock.lock(); defer { lock.unlock() }
    guard !closed, retained.values.reduce(0, { $0 + $1.consumers.count }) < 256 else { throw SlaxImageFailure() }
    if let previous = jobs[key], (try? previous.lease.check()) == nil { Array(previous.consumers.values).forEach { $0.close() } }
    let job: Job
    if let existing = jobs[key] { job = existing }
    else {
      guard retained.count < 128 else { throw SlaxImageFailure() }
      job = Job(key: key, original: original, policy: policy, lease: try SlaxStorageOwner.capture(owner), registry: self)
      jobs[key] = job; retained[job.id] = job; drained.enter()
    }
    let consumer = Consumer(registry: self, job: job, lease: lease, strict: strict); job.consumers[consumer.id] = consumer
    if job.state == "complete" { consumer.ready(job.result, error: job.error) }
    pump(); return consumer
  }
  private func host(_ url: URL) -> String { "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? (url.scheme == "https" ? 443 : 80))" }
  private func check(_ job: Job) throws {
    try job.lease.check()
    guard !closed, !job.consumers.isEmpty, job.error == nil else { throw job.error ?? SlaxImageFailure() }
  }
  private func pump() {
    guard !closed else { return }
    while running.count < 3, reserved + Self.maxBytes <= Self.totalBytes,
      let job = retained.values.first(where: { candidate in candidate.state == "queued" && !candidate.consumers.isEmpty && running.values.filter { host($0.original) == host(candidate.original) }.count < 2 }) {
      job.state = "running"; running[job.id] = job; job.reservation = Self.maxBytes; reserved += Self.maxBytes
      workers.addOperation { self.start(job) }
    }
  }
  private func request(_ url: URL) -> URLRequest {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.httpMethod = "GET"; request.httpShouldHandleCookies = false; return request
  }
  private func start(_ job: Job) {
    lock.lock(); defer { lock.unlock() }
    do {
      try check(job); let destination = host(job.original)
      guard destinations[destination, default: 0] < 2 else { throw SlaxImageFailure() }
      destinations[destination, default: 0] += 1; job.destination = destination
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
      configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 30
      let delegate = OperationQueue(); delegate.name = "SlaxImageDelegate"; delegate.qualityOfService = .utility; delegate.maxConcurrentOperationCount = 1
      let session = URLSession(configuration: configuration, delegate: job, delegateQueue: delegate)
      job.session = session; let task = session.dataTask(with: request(job.original)); job.task = task
      let expiry = DispatchWorkItem { self.fail(job, error: SlaxImageFailure()) }; job.expiry = expiry
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 30, execute: expiry); task.resume()
    } catch { job.error = error; finished(job, error: error) }
  }
  private func detach(_ job: Job, consumer: Consumer) {
    lock.lock(); defer { lock.unlock() }
    guard job.consumers.removeValue(forKey: consumer.id) != nil, job.consumers.isEmpty else { return }
    job.lease.cancel(); if jobs[job.key] === job { jobs.removeValue(forKey: job.key) }
    if job.state == "queued" { job.state = "retired"; retained.removeValue(forKey: job.id); drained.leave() }
    else if job.state == "complete" { cleanup(job) }
    else { job.task?.cancel(); job.session?.invalidateAndCancel() }
    pump()
  }
  private func releaseDestination(_ job: Job) {
    if let destination = job.destination {
      let count = destinations[destination, default: 1] - 1
      if count == 0 { destinations.removeValue(forKey: destination) } else { destinations[destination] = count }
      job.destination = nil
    }
  }
  private func fail(_ job: Job, error: Error) {
    lock.lock(); defer { lock.unlock() }
    guard job.state == "running" else { return }
    if job.error == nil { job.error = error }; job.task?.cancel(); job.session?.invalidateAndCancel()
  }
  private func redirect(_ job: Job, request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    lock.lock(); defer { lock.unlock() }
    do {
      try check(job); job.redirects += 1
      guard job.redirects <= 10, let url = request.url, job.policy.imageOriginal(url) != nil else { throw SlaxImageFailure(terminal: true) }
      releaseDestination(job); let destination = host(url)
      guard destinations[destination, default: 0] < 2 else { throw SlaxImageFailure() }
      destinations[destination, default: 0] += 1; job.destination = destination
      completionHandler(self.request(url))
    } catch { completionHandler(nil); fail(job, error: error) }
  }
  private func response(_ job: Job, response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    lock.lock(); defer { lock.unlock() }
    do {
      try check(job)
      guard let http = response as? HTTPURLResponse, let url = http.url, job.policy.imageOriginal(url) != nil else { throw SlaxImageFailure(terminal: true) }
      guard http.statusCode == 200 else { throw SlaxImageFailure(status: http.statusCode, retryAfter: http.value(forHTTPHeaderField: "Retry-After"), terminal: (400..<500).contains(http.statusCode) && ![408, 429].contains(http.statusCode)) }
      let mime = http.value(forHTTPHeaderField: "Content-Type")?.components(separatedBy: ";").first?.trimmingCharacters(in: .whitespaces).lowercased()
      let strict = job.policy.signedImageProxy(job.original) || job.policy.signedImageProxy(url)
      guard mime?.hasPrefix("image/") ?? !strict, response.expectedContentLength <= Self.maxBytes else { throw SlaxImageFailure(terminal: true) }
      let encoded = http.value(forHTTPHeaderField: "Content-Encoding").map { $0.lowercased() != "identity" } ?? false
      job.mime = mime; job.advertised = !encoded && response.expectedContentLength >= 0 ? response.expectedContentLength : nil
      completionHandler(.becomeDownload)
    } catch { completionHandler(.cancel); fail(job, error: error) }
  }
  private func progress(_ job: Job, received: Int64, expected: Int64) {
    lock.lock(); defer { lock.unlock() }
    do {
      try check(job)
      guard received <= Self.maxBytes, expected <= Self.maxBytes, job.advertised.map({received <= $0}) ?? true else { throw SlaxImageFailure(terminal: true) }
    } catch { fail(job, error: error) }
  }
  private func downloaded(_ job: Job, location: URL) {
    var temporary: URL?
    do {
      lock.lock(); let active = (try? check(job)) != nil; let expected = job.advertised; lock.unlock()
      guard active else { throw SlaxImageFailure() }
      let files = FileManager.default, attributes = try files.attributesOfItem(atPath: location.path)
      guard attributes[.type] as? FileAttributeType == .typeRegular, let size = attributes[.size] as? NSNumber,
        (1...Self.maxBytes).contains(size.int64Value), expected.map({size.int64Value == $0}) ?? true else { throw SlaxImageFailure(terminal: true) }
      guard directory.isFileURL, directory.standardizedFileURL.path == directory.resolvingSymlinksInPath().path else { throw SlaxFileStoreError.unsafe }
      try files.createDirectory(at: directory, withIntermediateDirectories: true)
      guard directory.path == directory.resolvingSymlinksInPath().path else { throw SlaxFileStoreError.unsafe }
      let target = directory.appendingPathComponent("slax-image-\(UUID().uuidString).tmp"); temporary = target
      try files.moveItem(at: location, to: target)
      lock.lock(); defer { lock.unlock() }; try check(job)
      job.result = SlaxImageResource(file: target, mime: job.mime, size: size.int64Value); temporary = nil
    } catch { if let temporary { try? FileManager.default.removeItem(at: temporary) }; fail(job, error: error) }
  }
  private func finished(_ job: Job, error: Error?) {
    lock.lock(); defer { lock.unlock() }
    guard job.state == "running" else { return }
    job.expiry?.cancel(); job.expiry = nil; job.session = nil; job.task = nil; releaseDestination(job); running.removeValue(forKey: job.id)
    if job.error == nil { job.error = error }
    if (try? check(job)) == nil || job.result == nil { job.error = job.error ?? SlaxImageFailure() }
    job.state = "complete"
    if job.error != nil { if jobs[job.key] === job { jobs.removeValue(forKey: job.key) } }
    else if let result = job.result { reserved -= job.reservation - result.size; job.reservation = result.size }
    Array(job.consumers.values).forEach { $0.ready(job.result, error: job.error) }
    if job.consumers.isEmpty { cleanup(job) }
    pump()
  }
  private func cleanup(_ job: Job) {
    job.state = "retired"
    workers.addOperation {
      var removed = true
      if let file = job.result?.file, FileManager.default.fileExists(atPath: file.path) {
        do { try FileManager.default.removeItem(at: file) } catch { removed = false }
      }
      self.lock.lock(); self.retained.removeValue(forKey: job.id)
      if removed { self.reserved -= job.reservation; job.reservation = 0 } else { _ = self.close() }
      self.drained.leave(); self.pump(); self.lock.unlock()
    }
  }
  func close() -> DispatchGroup {
    lock.lock(); defer { lock.unlock() }; closed = true
    Array(retained.values).flatMap { Array($0.consumers.values) }.forEach { $0.close() }
    return drained
  }
}
