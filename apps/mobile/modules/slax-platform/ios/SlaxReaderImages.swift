import Foundation
import WebKit
import ExpoModulesCore

private final class SlaxImageTask: NSObject, WKURLSchemeTask {
  let request: URLRequest
  let promise: Promise
  let current: () -> Bool
  let done: () -> Void
  var data = Data()
  var ended = false
  init(url: URL, promise: Promise, current: @escaping () -> Bool, done: @escaping () -> Void) {
    request = URLRequest(url: url); self.promise = promise; self.current = current; self.done = done
  }
  func didReceive(_ response: URLResponse) {}
  func didReceive(_ chunk: Data) { if !ended && current() { data.append(chunk) } }
  func didFinish() {
    guard !ended else { return }; ended = true
    if current() && !data.isEmpty { promise.resolve(data.base64EncodedString()) }
    else { promise.reject(NSError(domain: "SlaxReader", code: 1, userInfo: [NSLocalizedDescriptionKey: "Reader image released"])) }
    data.removeAll(); done()
  }
  func didFailWithError(_ error: Error) {
    guard !ended else { return }; ended = true; data.removeAll()
    promise.reject(NSError(domain: "SlaxReader", code: 2, userInfo: [NSLocalizedDescriptionKey: "Reader image unavailable"]))
    done()
  }
}

final class SlaxReaderImages {
  private static var requests: [String: (SlaxResourceStream, SlaxImageTask)] = [:]
  static func cancel(_ id: String) {
    guard let (stream, task) = requests.removeValue(forKey: id) else { return }
    stream.cancel(); task.didFailWithError(URLError(.cancelled))
  }
  static func cancelAll() { Array(requests.keys).forEach(cancel) }
  static func load(_ id: String, raw: String, owner: String, hosts: [String], proxies: [String], promise: Promise) throws {
    guard requests[id] == nil, SlaxReaderView.owns(owner), let url = URL(string: raw) else { throw URLError(.cancelled) }
    let policy = try SlaxReaderSecurity(hosts, imageProxyOrigins: proxies)
    guard let original = policy.imageOriginal(url) else { throw URLError(.badURL) }
    let current = { SlaxReaderView.owns(owner) }
    let task = SlaxImageTask(url: original, promise: promise, current: current) { requests.removeValue(forKey: id) }
    let stream = SlaxResourceStream(task: task, original: original, cache: { nil }, cached: { nil }, allowsNetwork: true, security: policy, privateImage: true, hasOwnership: current) { requests.removeValue(forKey: id) }
    requests[id] = (stream, task)
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
      if requests[id]?.1 === task { cancel(id) }
    }
    stream.start()
  }
}
