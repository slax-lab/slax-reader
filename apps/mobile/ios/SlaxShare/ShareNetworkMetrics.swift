import Foundation

final class ShareNetworkMetrics: @unchecked Sendable {
  private let lock = NSLock()
  private var reduced: [String: Any]?
  private var completedAt: DispatchTime?
  private var waiting: (([String: Any]?) -> Void)?
  func complete() { lock.lock(); if completedAt == nil { completedAt = .now() }; lock.unlock() }
  func receive(_ metrics: URLSessionTaskMetrics) {
    guard let last = metrics.transactionMetrics.last else { return }
    var phase = ShareNetworkPhases()
    phase.dnsStart = last.domainLookupStartDate; phase.dnsEnd = last.domainLookupEndDate
    phase.connectStart = last.connectStartDate; phase.connectEnd = last.connectEndDate
    phase.tlsStart = last.secureConnectionStartDate; phase.tlsEnd = last.secureConnectionEndDate
    phase.requestStart = last.requestStartDate; phase.requestEnd = last.requestEndDate
    phase.responseStart = last.responseStartDate; phase.responseEnd = last.responseEndDate
    phase.total = metrics.taskInterval.duration; phase.reused = last.isReusedConnection; phase.proxy = last.isProxyConnection
    phase.networkProtocol = last.networkProtocolName; phase.cellular = last.isCellular; phase.expensive = last.isExpensive; phase.constrained = last.isConstrained
    phase.remotePort = last.remotePort
    switch last.negotiatedTLSProtocolVersion {
    case .TLSv12: phase.tlsVersion = "1.2"
    case .TLSv13: phase.tlsVersion = "1.3"
    default: break
    }
    let result = ShareDiagnosticRecord.reduce(phase)
    lock.lock(); reduced = result; let callback = waiting; waiting = nil; lock.unlock()
    callback?(result)
  }
  func deliver(on queue: DispatchQueue, _ callback: @escaping ([String: Any]?) -> Void) {
    lock.lock()
    if let reduced { lock.unlock(); queue.async { callback(reduced) }; return }
    let deadline = (completedAt ?? .now()) + .milliseconds(300)
    if DispatchTime.now() >= deadline { lock.unlock(); queue.async { callback(nil) }; return }
    waiting = { result in queue.async { callback(result) } }
    lock.unlock()
    queue.asyncAfter(deadline: deadline) {
      self.lock.lock(); let callback = self.waiting; self.waiting = nil; self.lock.unlock()
      callback?(nil)
    }
  }
}

final class ShareRequestDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private let metrics: ShareNetworkMetrics?
  private let statusOnly: Bool
  private var session: URLSession?
  private var continuation: CheckedContinuation<(data: Data, response: HTTPURLResponse, error: Error?), Error>?
  private var deadline: DispatchWorkItem?
  private var response: HTTPURLResponse?
  private var data = Data()
  private var finished = false
  init(metrics: ShareNetworkMetrics? = nil, statusOnly: Bool = false) { self.metrics = metrics; self.statusOnly = statusOnly }
  func send(_ request: URLRequest, budget: TimeInterval) async throws -> (data: Data, response: HTTPURLResponse, error: Error?) {
    try await withTaskCancellationHandler(operation: {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { start(request, budget: budget, continuation: $0) }
    }, onCancel: { self.finish(error: CancellationError(), cancelled: true) })
  }
  private func start(_ request: URLRequest, budget: TimeInterval, continuation: CheckedContinuation<(data: Data, response: HTTPURLResponse, error: Error?), Error>) {
    lock.lock()
    guard !finished else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
    self.continuation = continuation
    let configuration = URLSessionConfiguration.ephemeral
    if #available(iOS 18.4, macOS 15.4, *) { configuration.usesClassicLoadingMode = false }
    configuration.timeoutIntervalForRequest = budget; configuration.timeoutIntervalForResource = budget
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    self.session = session
    let task = session.dataTask(with: request)
    let deadline = DispatchWorkItem { [weak self] in self?.finish(error: URLError(.timedOut)) }
    self.deadline = deadline
    DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + budget, execute: deadline)
    task.resume()
    lock.unlock()
  }
  private func finish(error: Error? = nil, cancelled: Bool = false) {
    lock.lock()
    guard !finished else { lock.unlock(); return }
    finished = true
    let continuation = self.continuation; self.continuation = nil
    let session = self.session; self.session = nil
    deadline?.cancel(); deadline = nil
    let response = self.response, data = self.data
    lock.unlock()
    metrics?.complete()
    session?.invalidateAndCancel()
    if cancelled { continuation?.resume(throwing: CancellationError()) }
    else if let response { continuation?.resume(returning: (data, response, [200, 204].contains(response.statusCode) ? nil : error)) }
    else { continuation?.resume(throwing: error ?? URLError(.badServerResponse)) }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    lock.lock()
    guard !finished, let response = response as? HTTPURLResponse else {
      lock.unlock(); completionHandler(.cancel); finish(error: URLError(.badServerResponse)); return
    }
    self.response = response
    let accepted = statusOnly || [200, 204].contains(response.statusCode)
    lock.unlock()
    if accepted { finish(); completionHandler(.cancel) }
    else { completionHandler(.allow) }
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock(); defer { lock.unlock() }
    guard !finished else { return }
    self.data.append(data)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { finish(error: error) }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) { self.metrics?.receive(metrics) }
}
