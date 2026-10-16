import Foundation

func expect(_ value: @autoclosure () throws -> Bool) rethrows { let result = try value(); precondition(result) }
func rejects(_ work: () throws -> Void) { var rejected = false; do { try work() } catch { rejected = true }; precondition(rejected) }
func drained() { for _ in 0..<300 { if SlaxPdfTransfers.count() == 0 { return }; Thread.sleep(forTimeInterval: 0.01) }; fatalError("PDF handles did not drain") }
@main struct Host {
  static func main() throws {
    let origin = CommandLine.arguments[1]
    try SlaxStorageOwner.activate("account-a")
    let headers = ["Authorization": "Bearer synthetic", "Accept": "application/pdf", "Range": "bytes=0-7", "X-CLIENT-TYPE": "ios", "X-CLIENT-VERSION": "test"]
    func begin() throws -> String { try SlaxPdfTransfers.begin(owner: "account-a", origin: origin, allowHTTP: true) }
    func transfer(_ id: String) throws -> SlaxPdfTransfer { try SlaxPdfTransfers.get(owner: "account-a", id: id) }
    func url(_ mode: String) -> String { origin + "/v1/bookmark/pdf?bookmark_uid=" + mode }
    let id = try begin(), first = try transfer(id)
    try expect(try first.open(url("full"), headers: headers)["status"] as? Int == 200)
    Thread.sleep(forTimeInterval: 0.03)
    var offset = 0
    while let bytes = try first.read() {
      precondition((1...SlaxPdfTransfers.chunkBytes).contains(bytes.count))
      for (index, byte) in bytes.enumerated() { precondition(Int(byte) == (offset + index) % 251) }
      offset += bytes.count
    }
    precondition(offset == 2 * 1024 * 1024 + 17); drained()
    let redirect = try begin(); try expect(try transfer(redirect).open(url("redirect"), headers: headers)["status"] as? Int == 302)
    SlaxPdfTransfers.end(owner: "account-a", id: redirect); drained()
    let denied = try begin(); try expect(try transfer(denied).open(url("denied"), headers: headers)["status"] as? Int == 403)
    SlaxPdfTransfers.end(owner: "account-a", id: denied); drained()
    for mode in ["oversize", "compressed", "truncated"] {
      let bad = try begin()
      rejects { let value = try transfer(bad); _ = try value.open(url(mode), headers: headers); while try value.read() != nil {} }
      SlaxPdfTransfers.end(owner: "account-a", id: bad); drained()
    }
    for bad in [origin + "/other", origin + "/v1/bookmark/pdf?bookmark_uid=full&extra=1", "https://other.test/v1/bookmark/pdf?bookmark_uid=full"] {
      let id = try begin(); rejects { _ = try transfer(id).open(bad, headers: headers) }; SlaxPdfTransfers.end(owner: "account-a", id: id); drained()
    }
    let headerId = try begin(); var forbidden = headers; forbidden["Cookie"] = "forbidden"
    rejects { _ = try transfer(headerId).open(url("full"), headers: forbidden) }; SlaxPdfTransfers.end(owner: "account-a", id: headerId); drained()
    rejects { _ = try SlaxPdfTransfers.begin(owner: "account-a", origin: "http://remote.test", allowHTTP: true) }
    rejects { _ = try SlaxPdfTransfers.begin(owner: "account-a", origin: origin, allowHTTP: false) }
    let capacity = try (0..<6).map { _ in try begin() }; rejects { _ = try begin() }
    capacity.forEach { SlaxPdfTransfers.end(owner: "account-a", id: $0) }; drained()
    let slow = try begin(), pending = try transfer(slow); _ = try pending.open(url("slow"), headers: headers)
    let entered = DispatchSemaphore(value: 0), finished = DispatchSemaphore(value: 0), lock = NSLock(); var cancelled = false
    DispatchQueue.global().async {
      entered.signal()
      do { _ = try pending.read() } catch { lock.lock(); cancelled = true; lock.unlock() }
      finished.signal()
    }
    precondition(entered.wait(timeout: .now() + 2) == .success); SlaxPdfTransfers.end(owner: "account-a", id: slow)
    precondition(finished.wait(timeout: .now() + 3) == .success); lock.lock(); precondition(cancelled); lock.unlock(); drained()
    let stale = try begin(), old = try transfer(stale); _ = try old.open(url("full"), headers: headers)
    try SlaxStorageOwner.activate("account-b"); rejects { _ = try old.read() }; SlaxPdfTransfers.revokeAll(); drained()
    print("Swift bounded PDF transport passed")
  }
}
