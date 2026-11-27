import Foundation
import Darwin
import Network

/// One bounded snapshot of the path to a Slax-owned host: resolver answers as address counts, TCP connect timing per
/// address family and the current path's properties. No address is ever returned, only counts, durations and error classes.
enum SlaxNetworkProbe {
  static let queue = DispatchQueue(label: "SlaxNetworkProbe", qos: .utility, attributes: .concurrent)
  private static let stepSeconds = 3

  static func allowed(host: String, suffixes: [String]) -> Bool {
    let normalized = host.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    guard normalized.range(of: "^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$", options: .regularExpression) != nil,
      !normalized.split(separator: ".", omittingEmptySubsequences: false).contains(where: { $0.isEmpty }) else { return false }
    return suffixes.contains { suffix in
      let root = suffix.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
      return !root.isEmpty && (normalized == root || normalized.hasSuffix("." + root))
    }
  }

  static func probe(host: String) -> [String: Any] {
    var started = DispatchTime.now()
    var system: [String: Any] = [:]
    var v4: [sockaddr_storage] = [], v6: [sockaddr_storage] = []
    do {
      (v4, v6) = try resolve(host)
      system = ["ms": elapsed(started), "v4": v4.count, "v6": v6.count]
    } catch { system = ["ms": elapsed(started), "error": errorClass(error)] }
    started = DispatchTime.now()
    var publicAnswer: [String: Any]
    do {
      let answer = try SlaxDns.lookup(host: host, server: "1.1.1.1")
      publicAnswer = ["ms": elapsed(started), "v4": answer.split(separator: ",").count]
    } catch { publicAnswer = ["ms": elapsed(started), "error": errorClass(error)] }
    var tcp: [String: Any] = [:]
    if var address = v4.first { tcp["v4"] = connect(&address) }
    if var address = v6.first { tcp["v6"] = connect(&address) }
    return ["dns": ["system": system, "public": publicAnswer], "tcp": tcp, "network": network()]
  }

  private static func elapsed(_ started: DispatchTime) -> Int { Int((DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000) }
  private static func errorClass(_ error: Error) -> String {
    let nsError = error as NSError
    return String("\(nsError.domain):\(nsError.code)".prefix(64))
  }
  private static func failure(_ code: Int32) -> NSError { NSError(domain: "SlaxNetworkProbe", code: Int(code)) }

  private static func resolve(_ host: String) throws -> ([sockaddr_storage], [sockaddr_storage]) {
    var hints = addrinfo(); hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM
    var first: UnsafeMutablePointer<addrinfo>?
    let status = getaddrinfo(host, "443", &hints, &first)
    guard status == 0 else { throw NSError(domain: "getaddrinfo", code: Int(status)) }
    defer { if let first { freeaddrinfo(first) } }
    var v4: [sockaddr_storage] = [], v6: [sockaddr_storage] = []
    var cursor = first
    while let current = cursor {
      if let address = current.pointee.ai_addr {
        var storage = sockaddr_storage()
        withUnsafeMutableBytes(of: &storage) { buffer in
          buffer.copyMemory(from: UnsafeRawBufferPointer(start: address, count: Int(current.pointee.ai_addrlen)))
        }
        if current.pointee.ai_family == AF_INET { v4.append(storage) } else if current.pointee.ai_family == AF_INET6 { v6.append(storage) }
      }
      cursor = current.pointee.ai_next
    }
    return (v4, v6)
  }

  private static func connect(_ address: inout sockaddr_storage) -> [String: Any] {
    let started = DispatchTime.now()
    let family = Int32(address.ss_family)
    let length = socklen_t(family == AF_INET6 ? MemoryLayout<sockaddr_in6>.size : MemoryLayout<sockaddr_in>.size)
    let descriptor = socket(family, SOCK_STREAM, IPPROTO_TCP)
    guard descriptor >= 0 else { return ["ok": false, "ms": elapsed(started), "error": "socket"] }
    defer { close(descriptor) }
    var noSigpipe: Int32 = 1
    setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSigpipe, socklen_t(MemoryLayout<Int32>.size))
    _ = fcntl(descriptor, F_SETFL, fcntl(descriptor, F_GETFL, 0) | O_NONBLOCK)
    let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(descriptor, $0, length) } }
    if result == 0 { return ["ok": true, "ms": elapsed(started)] }
    guard errno == EINPROGRESS else { return ["ok": false, "ms": elapsed(started), "error": "errno:\(errno)"] }
    var poller = pollfd(fd: descriptor, events: Int16(POLLOUT), revents: 0)
    let ready = poll(&poller, 1, Int32(stepSeconds * 1000))
    guard ready > 0 else { return ["ok": false, "ms": elapsed(started), "error": ready == 0 ? "timeout" : "errno:\(errno)"] }
    var socketError: Int32 = 0, size = socklen_t(MemoryLayout<Int32>.size)
    getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &socketError, &size)
    return socketError == 0 ? ["ok": true, "ms": elapsed(started)] : ["ok": false, "ms": elapsed(started), "error": "errno:\(socketError)"]
  }

  private static func network() -> [String: Any] {
    let monitor = NWPathMonitor(), done = DispatchSemaphore(value: 0)
    var snapshot: [String: Any] = ["transport": "other"]
    monitor.pathUpdateHandler = { path in
      let vpn = path.availableInterfaces.contains { $0.type == .other && ($0.name.hasPrefix("utun") || $0.name.hasPrefix("ipsec")) }
      let transport = path.status != .satisfied ? "none" : path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : vpn ? "vpn" : "other"
      snapshot = ["transport": transport, "vpn": vpn, "metered": path.isExpensive, "constrained": path.isConstrained, "ipv6_route": path.supportsIPv6]
      done.signal()
    }
    monitor.start(queue: DispatchQueue(label: "SlaxNetworkProbe.path"))
    _ = done.wait(timeout: .now() + 1)
    monitor.cancel()
    return snapshot
  }
}
