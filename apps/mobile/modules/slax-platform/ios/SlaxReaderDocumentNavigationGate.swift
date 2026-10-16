// Shared by the production WK delegate and the bounded pure-Swift host test.
struct SlaxReaderDocumentNavigationGate {
  private var initialRequestAdmitted = false
  private var initialNavigationStarted = false
  private var invalidated = false

  mutating func admitMainFrame(isInitialRequest: Bool) -> Bool {
    guard !invalidated, !initialRequestAdmitted, isInitialRequest else { return false }
    initialRequestAdmitted = true
    return true
  }
  mutating func start(isExpectedNavigation: Bool) -> Bool {
    guard !invalidated, initialRequestAdmitted, isExpectedNavigation else { invalidate(); return false }
    initialNavigationStarted = true
    return true
  }
  mutating func finish(isExpectedNavigation: Bool) -> Bool {
    guard permitsSource, isExpectedNavigation else { invalidate(); return false }
    return true
  }
  var permitsSource: Bool { !invalidated && initialRequestAdmitted && initialNavigationStarted }
  mutating func invalidate() { invalidated = true }
}
