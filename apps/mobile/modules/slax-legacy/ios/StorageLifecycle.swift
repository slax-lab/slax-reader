import Foundation
import UIKit

final class StorageOwner {
  private static let mutex = NSLock()
  private static var current: UUID?
  private let identity = UUID()

  func acquire() throws {
    Self.mutex.lock(); defer { Self.mutex.unlock() }
    guard Self.current == nil else { throw CocoaError(.fileLocking) }
    Self.current = identity
  }

  func release() {
    Self.mutex.lock(); defer { Self.mutex.unlock() }
    if Self.current == identity { Self.current = nil }
  }
}

final class StorageActivity {
  private var identifier = UIBackgroundTaskIdentifier.invalid
  private var deadline: DispatchWorkItem?
  private var observers: [NSObjectProtocol] = []
  private var generation = 0
  private let mutex = NSLock()
  private var expired = false
  private var finished = false
  private let name: String
  private let seconds: TimeInterval
  private let cancel: () -> Void

  init(name: String, seconds: TimeInterval = 5, cancel: @escaping () -> Void = {}) throws {
    self.name = name; self.seconds = seconds; self.cancel = cancel
    let begin = {
      let center = NotificationCenter.default
      for notification in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
        self.observers.append(center.addObserver(forName: notification, object: nil, queue: .main) { [weak self] _ in self?.enterBackground() })
      }
      self.observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.endBackground() })
      if UIApplication.shared.applicationState != .active { self.enterBackground() }
    }
    if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
    try check()
  }

  func check() throws {
    mutex.lock(); defer { mutex.unlock() }
    guard !expired && !finished else { throw CocoaError(.fileLocking) }
  }

  func enterBackground() {
    if !Thread.isMainThread { DispatchQueue.main.sync { self.enterBackground() }; return }
    guard (try? check()) != nil, identifier == .invalid else { return }
    generation += 1
    let current = generation
    identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.expire(current) }
    guard identifier != .invalid else { expire(current); return }
    let deadline = DispatchWorkItem { [weak self] in self?.expire(current) }
    self.deadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: deadline)
  }

  private func expire(_ expected: Int) {
    guard expected == generation else { return }
    mutex.lock()
    if expired || finished { mutex.unlock(); return }
    expired = true; mutex.unlock()
    cancel()
    finish()
  }

  private func endBackground() {
    generation += 1
    deadline?.cancel(); deadline = nil
    if identifier != .invalid {
      UIApplication.shared.endBackgroundTask(identifier)
      identifier = .invalid
    }
  }

  func finish() {
    let end = {
      self.mutex.lock(); self.finished = true; self.mutex.unlock()
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }; self.observers = []
      self.endBackground()
    }
    if Thread.isMainThread { end() } else { DispatchQueue.main.sync(execute: end) }
  }
}

final class StorageTransition {
  private var activities: [Int: StorageActivity] = [:]
  private var token = 0
  private var observers: [NSObjectProtocol] = []
  private var backgroundActivity: StorageActivity?

  func observe() {
    if !Thread.isMainThread { DispatchQueue.main.sync { self.observe() }; return }
    guard observers.isEmpty else { return }
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.backgroundActivity?.finish()
      self.backgroundActivity = try? StorageActivity(name: "Slax storage suspension")
      self.backgroundActivity?.enterBackground()
    })
    observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      self?.backgroundActivity?.finish(); self?.backgroundActivity = nil
    })
  }

  func stopObserving() {
    if !Thread.isMainThread { DispatchQueue.main.sync { self.stopObserving() }; return }
    observers.forEach { NotificationCenter.default.removeObserver($0) }; observers = []
    backgroundActivity?.finish(); backgroundActivity = nil
    for key in Array(activities.keys) { finish(key) }
  }

  func begin() throws -> Int {
    if !Thread.isMainThread { return try DispatchQueue.main.sync { try self.begin() } }
    token += 1
    let key = token
    activities[key] = try StorageActivity(name: "Slax storage work", cancel: { [weak self] in self?.finish(key) })
    return key
  }

  func check(_ key: Int) throws {
    if !Thread.isMainThread { return try DispatchQueue.main.sync { try self.check(key) } }
    guard let activity = activities[key] else { throw CocoaError(.userCancelled) }
    try activity.check()
  }

  func finish(_ key: Int) {
    if !Thread.isMainThread { DispatchQueue.main.sync { self.finish(key) }; return }
    activities.removeValue(forKey: key)?.finish()
  }
}
