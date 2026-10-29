import Foundation

enum ShareFailure: Error { case message(String) }
enum ShareCollector {
  @discardableResult
  static func collect(content: String, title: String?, diagnostics: ShareDiagnostics? = nil) async throws -> ShareResult {
    var result = ShareResult()
    defer { diagnostics?.update(result) }
    guard let range = content.range(of: "^((https|http)?://)[^\\s]+", options: .regularExpression) else { throw ShareFailure.message("Not have URL content to collect.") }
    result.stage = "prefs"; result.reason = "prefs_unavailable"
    diagnostics?.advance(result.stage, reason: result.reason)
    let prefsStarted = Date()
    var store = "none"
    let values: [String: Any]
    do {
      defer {
        result.ms["prefs"] = ShareDiagnosticRecord.milliseconds(prefsStarted, Date())
        diagnostics?.duration("prefs", since: prefsStarted)
      }
      values = try SharedPreferences.read { selected, error in
        store = selected; diagnostics?.preferences(store: selected, error: error, values: nil)
      }
    } catch {
      let native = error as NSError
      result.error = ShareDiagnosticRecord.error(native)
      if native.domain == NSCocoaErrorDomain && [NSFileReadCorruptFileError, 3840].contains(native.code) { result.reason = "prefs_corrupt" }
      throw error
    }
    diagnostics?.preferences(store: store, error: nil, values: values)
    result.stage = "auth"; result.reason = values["_slax_sign_out_pending_v1"] as? Bool == true ? "signed_out" : "no_token"
    diagnostics?.advance(result.stage, reason: result.reason)
    guard values["_slax_sign_out_pending_v1"] as? Bool != true,
      let token = values["auth_token"] as? String, !token.isEmpty else { throw ShareFailure.message("Not have auth info, please login first.") }
    let info = Bundle.main.infoDictionary ?? [:]
    let endpointKey = (values["selected_env"] as? String) == "BETA" ? "SlaxApiBetaURL" : "SlaxApiBaseURL"
    result.stage = "request"; result.reason = "endpoint_missing"
    diagnostics?.advance(result.stage, reason: result.reason)
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
    let metrics = ShareNetworkMetrics()
    diagnostics?.request(host: url.host, metrics: metrics)
    result.reason = "network_other"
    let requestStarted = Date()
    defer { result.ms["request"] = ShareDiagnosticRecord.milliseconds(requestStarted, Date()) }
    do {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = 8; configuration.timeoutIntervalForResource = 15
      let session = URLSession(configuration: configuration, delegate: ShareRequestDelegate(metrics: metrics), delegateQueue: nil)
      defer { session.invalidateAndCancel() }
      let (data, response) = try await session.data(for: request)
      metrics.complete()
      result.stage = "response"; result.reason = "http_other"
      diagnostics?.advance(result.stage, reason: result.reason)
      guard let response = response as? HTTPURLResponse else { throw ShareFailure.message("Collection failed, please try again.") }
      let json: [String: Any]? = [200, 204].contains(response.statusCode) ? nil : (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
      let responseCode: Any = (json?["code"] as? NSNumber).map { $0 as Any } ?? ShareDiagnosticRecord.value(ShareDiagnosticRecord.identifier(json?["code"] as? String))
      result.http = ["status": response.statusCode, "errorName": ShareDiagnosticRecord.value(ShareDiagnosticRecord.identifier(json?["data"] as? String)), "code": responseCode, "cfRay": ShareDiagnosticRecord.value(ShareDiagnosticRecord.identifier(response.value(forHTTPHeaderField: "CF-Ray")))]
      switch response.statusCode {
      case 200, 204: result.reason = "success"
      case 401: result.reason = "http_401"
      case 400: result.reason = "http_400"
      case 429: result.reason = "http_429"
      case 500...599: result.reason = "http_5xx"
      default: break
      }
      if response.statusCode == 401 { throw ShareFailure.message("Auth expired, please reopen the app to login again.") }
      if response.statusCode == 400, let json, let message = json["message"] as? String, !message.isEmpty { throw ShareFailure.message(message) }
      guard response.statusCode == 200 || response.statusCode == 204 else { throw ShareFailure.message("Collection failed, please try again.") }
      result.stage = "done"
      result.ms["request"] = ShareDiagnosticRecord.milliseconds(requestStarted, Date())
      return result
    } catch {
      metrics.complete()
      if !(error is ShareFailure) {
        let native = error as NSError
        result.error = ShareDiagnosticRecord.error(native)
        switch native.code {
        case NSURLErrorCancelled: result.reason = "cancelled"
        case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost: result.reason = "network_offline"
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: result.reason = "network_dns"
        case NSURLErrorTimedOut: result.reason = "network_timeout"
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected, NSURLErrorClientCertificateRequired: result.reason = "network_tls"
        default: result.reason = "network_other"
        }
      }
      if Task.isCancelled { result.reason = "cancelled"; throw CancellationError() }
      if let failure = error as? ShareFailure { throw failure }
      let code = (error as NSError).code
      if code == NSURLErrorTimedOut { throw ShareFailure.message("Request timed out, please try again.") }
      if [NSURLErrorCannotFindHost, NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost].contains(code) { throw ShareFailure.message("Network unavailable, please check your connection.") }
      throw ShareFailure.message("Collection failed, please try again.")
    }
  }
}
