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

final class ShareRequestDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  private let metrics: ShareNetworkMetrics
  init(metrics: ShareNetworkMetrics) { self.metrics = metrics }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) { self.metrics.receive(metrics) }
}
