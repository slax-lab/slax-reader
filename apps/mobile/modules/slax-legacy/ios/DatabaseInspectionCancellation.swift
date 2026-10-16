import Foundation
import SQLite3

final class DatabaseInspectionCancellation {
  private let mutex = NSCondition()
  private var database: OpaquePointer?
  private var cancelled = false

  func attach(_ database: OpaquePointer) throws {
    mutex.lock(); defer { mutex.unlock() }
    guard !cancelled else { throw CocoaError(.userCancelled) }
    self.database = database
    sqlite3_progress_handler(database, 1000, { pointer in
      guard let pointer else { return 1 }
      return Unmanaged<DatabaseInspectionCancellation>.fromOpaque(pointer).takeUnretainedValue().isCancelled ? 1 : 0
    }, Unmanaged.passUnretained(self).toOpaque())
  }

  var isCancelled: Bool {
    mutex.lock(); defer { mutex.unlock() }
    return cancelled
  }

  func check() throws { if isCancelled { throw CocoaError(.userCancelled) } }

  func cancel() {
    mutex.lock(); defer { mutex.unlock() }
    cancelled = true
    if let database { sqlite3_interrupt(database) }
  }

  func cancelAndDrain() {
    cancel()
    mutex.lock(); defer { mutex.unlock() }
    let deadline = Date().addingTimeInterval(0.3)
    while database != nil { if !mutex.wait(until: deadline) { break } }
  }

  func close(_ handle: OpaquePointer) {
    mutex.lock(); defer { mutex.unlock() }
    sqlite3_progress_handler(handle, 0, nil, nil)
    sqlite3_close(handle)
    database = nil
    mutex.broadcast()
  }

  func detach() {
    mutex.lock(); defer { mutex.unlock() }
    if let database { sqlite3_progress_handler(database, 0, nil, nil) }
    database = nil
    mutex.broadcast()
  }
}
