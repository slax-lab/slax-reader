import Foundation

enum ShareFailure: Error { case message(String) }
enum ShareCollector {
  static func collect(content: String, title: String?) async throws {
    guard let range = content.range(of: "^((https|http)?://)[^\\s]+", options: .regularExpression) else { throw ShareFailure.message("Not have URL content to collect.") }
    let values = try SharedPreferences.read()
    guard let token = values["auth_token"] as? String, !token.isEmpty else { throw ShareFailure.message("Not have auth info, please login first.") }
    let info = Bundle.main.infoDictionary ?? [:]
    let endpointKey = (values["selected_env"] as? String) == "BETA" ? "SlaxApiBetaURL" : "SlaxApiBaseURL"
    guard let base = info[endpointKey] as? String, let url = URL(string: "/v1/bookmark/add_url", relativeTo: URL(string: base))?.absoluteURL else { throw ShareFailure.message("Collection failed, please try again.") }
    let version = "\(info["CFBundleShortVersionString"] as? String ?? "") (\(info["CFBundleVersion"] as? String ?? ""))"
    var request = URLRequest(url: url)
    request.httpMethod = "POST"; request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("SlaxReader/iOS \(version)", forHTTPHeaderField: "User-Agent")
    var body: [String: String] = ["target_url": String(content[range])]
    if let title { body["target_title"] = title }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    do {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 15
      let session = URLSession(configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
      defer { session.invalidateAndCancel() }
      let (data, response) = try await session.data(for: request)
      guard let response = response as? HTTPURLResponse else { throw ShareFailure.message("Collection failed, please try again.") }
      if response.statusCode == 401 { throw ShareFailure.message("Auth expired, please reopen the app to login again.") }
      if response.statusCode == 400, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let message = json["message"] as? String, !message.isEmpty { throw ShareFailure.message(message) }
      guard response.statusCode == 200 || response.statusCode == 204 else { throw ShareFailure.message("Collection failed, please try again.") }
    } catch {
      if Task.isCancelled { throw CancellationError() }
      if let failure = error as? ShareFailure { throw failure }
      let code = (error as NSError).code
      if code == NSURLErrorTimedOut { throw ShareFailure.message("Request timed out, please try again.") }
      if [NSURLErrorCannotFindHost, NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost].contains(code) { throw ShareFailure.message("Network unavailable, please check your connection.") }
      throw ShareFailure.message("Collection failed, please try again.")
    }
  }
  private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  }
}
