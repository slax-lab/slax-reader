import Foundation

public struct UIBackgroundTaskIdentifier: Equatable, Hashable {
  public let rawValue: Int
  public static let invalid = UIBackgroundTaskIdentifier(rawValue: -1)
}
public final class UIApplication {
  public static let shared = UIApplication()
  public static let willResignActiveNotification = Notification.Name("willResignActive")
  public static let didEnterBackgroundNotification = Notification.Name("didEnterBackground")
  public static let didBecomeActiveNotification = Notification.Name("didBecomeActive")
  public enum State { case active, inactive, background }
  public var applicationState = State.inactive
  public var allowed = true
  public private(set) var active: [UIBackgroundTaskIdentifier: () -> Void] = [:]
  public private(set) var ended = 0
  private var next = 0
  public func beginBackgroundTask(withName name: String?, expirationHandler handler: (() -> Void)?) -> UIBackgroundTaskIdentifier {
    precondition(Thread.isMainThread)
    if !allowed { return .invalid }
    next += 1
    let identifier = UIBackgroundTaskIdentifier(rawValue: next)
    active[identifier] = handler ?? {}
    return identifier
  }
  public func endBackgroundTask(_ identifier: UIBackgroundTaskIdentifier) {
    precondition(Thread.isMainThread)
    precondition(active.removeValue(forKey: identifier) != nil)
    ended += 1
  }
  public func expire() { for handler in Array(active.values) { handler() } }
}
