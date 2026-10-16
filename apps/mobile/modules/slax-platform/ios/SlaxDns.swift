import Foundation
import Darwin

enum SlaxDns {
  static func lookup(host: String, server: String?) throws -> String {
    if let server { return try query(host: host, server: server) }
    var hints = addrinfo(); hints.ai_family = AF_INET; hints.ai_socktype = SOCK_STREAM
    var first: UnsafeMutablePointer<addrinfo>?
    let status = getaddrinfo(host, nil, &hints, &first)
    guard status == 0 else { throw failure(String(cString: gai_strerror(status))) }
    defer { if let first { freeaddrinfo(first) } }
    var cursor = first; var addresses: [String] = []
    while let current = cursor {
      if let address = current.pointee.ai_addr {
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(address, current.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 { addresses.append(String(cString: buffer)) }
      }
      cursor = current.pointee.ai_next
    }
    guard !addresses.isEmpty else { throw failure("No addresses resolved") }; return Array(Set(addresses)).sorted().joined(separator: ", ")
  }
  private static func failure(_ message: String) -> NSError { NSError(domain: "SlaxDns", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  private static func query(host: String, server: String) throws -> String {
    guard ["8.8.8.8", "1.1.1.1"].contains(server) else { throw failure("Unsupported diagnostic DNS server") }
    let descriptor = socket(AF_INET, SOCK_DGRAM, 0)
    guard descriptor >= 0 else { throw failure("DNS socket unavailable") }; defer { close(descriptor) }
    var timeout = timeval(tv_sec: 5, tv_usec: 0)
    setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET); address.sin_port = UInt16(53).bigEndian
    guard inet_pton(AF_INET, server, &address.sin_addr) == 1 else { throw failure("Invalid DNS address") }
    let connected = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    guard connected == 0 else { throw failure("DNS connection failed") }
    let id = UInt16.random(in: 0...65535)
    var request: [UInt8] = [UInt8(id >> 8), UInt8(id & 255), 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]
    for label in host.split(separator: ".") { let bytes = Array(label.utf8); guard (1...63).contains(bytes.count) else { throw failure("Invalid DNS label") }; request.append(UInt8(bytes.count)); request.append(contentsOf: bytes) }
    request.append(contentsOf: [0, 0, 1, 0, 1])
    guard request.withUnsafeBytes({ send(descriptor, $0.baseAddress, request.count, 0) }) == request.count else { throw failure("DNS send failed") }
    var response = [UInt8](repeating: 0, count: 4096)
    let size = response.withUnsafeMutableBytes { recv(descriptor, $0.baseAddress, $0.count, 0) }
    guard size >= 12 else { throw failure("No DNS response") }
    func number(_ offset: Int) throws -> Int { guard offset + 1 < size else { throw failure("Truncated DNS response") }; return Int(response[offset]) << 8 | Int(response[offset + 1]) }
    guard try number(0) == Int(id), try number(2) & 0x800f == 0x8000 else { throw failure("Invalid DNS response") }
    func skipName(_ offset: Int) throws -> Int {
      var index = offset
      for _ in 0..<128 {
        guard index < size else { throw failure("Truncated DNS name") }
        let length = Int(response[index]); index += 1
        if length == 0 { return index }
        if length & 192 == 192 { guard index < size else { throw failure("Truncated DNS pointer") }; return index + 1 }
        guard length <= 63 else { throw failure("Invalid DNS name") }; index += length
      }
      throw failure("Invalid DNS name")
    }
    var offset = 12
    for _ in 0..<(try number(4)) { offset = try skipName(offset) + 4 }
    var addresses: [String] = []
    for _ in 0..<(try number(6)) {
      offset = try skipName(offset)
      let type = try number(offset), length = try number(offset + 8); offset += 10
      guard offset + length <= size else { throw failure("Truncated DNS answer") }
      if type == 1 && length == 4 { addresses.append(response[offset..<(offset + 4)].map(String.init).joined(separator: ".")) }
      offset += length
    }
    guard !addresses.isEmpty else { throw failure("No DNS address returned") }; return addresses.joined(separator: ", ")
  }
}
