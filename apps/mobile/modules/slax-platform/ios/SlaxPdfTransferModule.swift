import ExpoModulesCore
import Foundation

public final class SlaxPdfTransferModule: Module {
  private func submit(owner: String, id: String, promise: Promise, work: @escaping (SlaxPdfTransfer) throws -> Any?) throws {
    guard let transfer = try? SlaxPdfTransfers.get(owner: owner, id: id) else { promise.resolve(["error": "cancelled"]); return }
    guard transfer.reserve() else { promise.resolve(["error": "busy"]); return }
    SlaxPdfTransfers.execute {
      do { let value = try work(transfer); transfer.completeOperation(); promise.resolve(value) }
      catch {
        transfer.completeOperation(); SlaxPdfTransfers.end(owner: owner, id: id)
        promise.resolve(["error": (error as? SlaxPdfTransferError)?.code ?? "network"])
      }
    }
  }
  public func definition() -> ModuleDefinition {
    Name("SlaxPdfTransfer")
    Function("begin") { (owner: String, origin: String) throws -> String in
      #if DEBUG
      let allowHTTP = true
      #else
      let allowHTTP = false
      #endif
      return try SlaxPdfTransfers.begin(owner: owner, origin: origin, allowHTTP: allowHTTP)
    }
    Function("end") { (owner: String, id: String) in SlaxPdfTransfers.end(owner: owner, id: id) }
    AsyncFunction("open") { (owner: String, id: String, url: String, headers: [String: String], promise: Promise) in
      try self.submit(owner: owner, id: id, promise: promise) { try $0.open(url, headers: headers) }
    }
    AsyncFunction("read") { (owner: String, id: String, promise: Promise) in
      try self.submit(owner: owner, id: id, promise: promise) { try $0.read() }
    }
  }
}
