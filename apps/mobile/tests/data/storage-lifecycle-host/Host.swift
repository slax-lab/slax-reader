import Foundation
import SQLite3
import UIKit

@main struct Host {
  static func main() throws {
    let first = StorageOwner(), second = StorageOwner()
    try first.acquire()
    do { try second.acquire(); preconditionFailure("Competing owner accepted") } catch {}
    second.release()
    do { try first.acquire(); preconditionFailure("Reentrant owner accepted") } catch {}
    first.release(); try second.acquire(); second.release()

    let application = UIApplication.shared
    let completed = try StorageActivity(name: "completed")
    precondition(application.active.count == 1)
    completed.finish(); completed.finish()
    precondition(application.active.isEmpty && application.ended == 1)
    var cancelled = false
    let expired = try StorageActivity(name: "expired", cancel: { cancelled = true })
    application.expire()
    precondition(cancelled)
    do {try expired.check(); preconditionFailure("Expired assertion accepted work")} catch {}
    expired.finish()
    precondition(application.active.isEmpty && application.ended == 2)
    let bounded = try StorageActivity(name: "deadline", seconds: 0.01)
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    do {try bounded.check(); preconditionFailure("Deadline accepted work")} catch {}
    precondition(application.active.isEmpty)
    application.allowed = false
    do {_ = try StorageActivity(name: "denied"); preconditionFailure("Denied assertion accepted work")} catch {}
    application.allowed = true
    let transition = StorageTransition(), old = try transition.begin(), new = try transition.begin()
    transition.finish(old)
    precondition(application.active.count == 1)
    do {try transition.check(old); preconditionFailure("Finished token accepted")} catch {}
    try transition.check(new)
    application.expire()
    do {try transition.check(new); preconditionFailure("Expired token accepted")} catch {}
    transition.finish(old); transition.finish(new)
    precondition(application.active.isEmpty)
    transition.observe(); transition.observe()
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
    precondition(application.active.count == 1)
    transition.stopObserving()
    precondition(application.active.isEmpty)
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
    precondition(application.active.isEmpty)

    func background() {
      application.applicationState = .inactive
      NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
      application.applicationState = .background
      NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
    }
    func foreground() {
      application.applicationState = .active
      NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    foreground()
    let longForeground = try StorageActivity(name: "long foreground")
    let longToken = try transition.begin()
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    try longForeground.check(); try transition.check(longToken)
    precondition(application.active.isEmpty)
    background()
    precondition(application.active.count == 2)
    foreground()
    precondition(application.active.isEmpty)
    try longForeground.check(); try transition.check(longToken)
    longForeground.finish(); transition.finish(longToken)

    var backgroundCancelled = false
    let backgroundBound = try StorageActivity(name: "background bound", seconds: 0.02, cancel: { backgroundCancelled = true })
    background()
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    precondition(backgroundCancelled && application.active.isEmpty)
    foreground()
    do {try backgroundBound.check(); preconditionFailure("Foreground revived expired work")} catch {}

    let rapid = try StorageActivity(name: "rapid lifecycle", seconds: 0.05)
    let rapidToken = try transition.begin()
    background()
    let obsoleteExpirations = Array(application.active.values)
    foreground()
    obsoleteExpirations.forEach { $0() }
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    try rapid.check(); try transition.check(rapidToken)
    precondition(application.active.isEmpty)
    background()
    precondition(application.active.count == 2)
    RunLoop.main.run(until: Date().addingTimeInterval(5.1))
    precondition(application.active.isEmpty)
    foreground()
    do {try rapid.check(); preconditionFailure("Rapid lifecycle revived expired work")} catch {}
    do {try transition.check(rapidToken); preconditionFailure("Foreground revived expired token")} catch {}
    transition.finish(rapidToken)

    let root = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
    let support = root.appendingPathComponent("support"), shared = root.appendingPathComponent("shared")
    let file = support.appendingPathComponent("databases/powersync.db")
    try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: shared, withIntermediateDirectories: true)
    try Data("unreadable old database".utf8).write(to: file)
    let reset = LegacyReset(support: support, shared: shared)
    let cleared = try reset.prepare(); precondition(cleared)
    precondition(!FileManager.default.fileExists(atPath: file.path))
    try reset.finish()
    let repeated = try reset.prepare(); precondition(!repeated)
    print("production Swift lifecycle and fixed-path reset passed; UIKit assertion boundary is synthetic")
  }
}
