# Spec Delta

## MODIFIED Requirements

### Requirement: Preserve safe local recovery

Platform selection SHALL preserve existing bounded recovery. Initialization timeout, cleanup timeout, or cleanup failure SHALL stop further local database attempts for that page initialization and select REST fallback. A definite initialization failure with completed cleanup SHALL permit the existing next-mode recovery path. An initialization timeout SHALL retain the timed-out database instance without closing it and SHALL let its initialization continue in the background; recovery SHALL NOT start another local database instance for that page initialization.

#### Scenario: Dedicated initialization does not finish
- **WHEN** a dedicated-first session reaches the initialization timeout
- **THEN** it selects REST fallback without starting another local database instance

#### Scenario: Failed dedicated database cannot be cleaned up
- **WHEN** dedicated initialization fails and cleanup times out or reports an error
- **THEN** it selects REST fallback without trying main-thread initialization

#### Scenario: Dedicated initialization fails and cleanup succeeds
- **WHEN** dedicated initialization fails before its timeout and cleanup completes successfully
- **THEN** recovery can attempt main-thread initialization

#### Scenario: Timed-out initialization is retained
- **WHEN** any mode reaches the initialization timeout
- **THEN** the page selects REST fallback at the timeout bound
- **AND** the timed-out instance is not closed and its initialization continues
- **AND** diagnostics report whether the background initialization later completed or failed and its duration

## ADDED Requirements

### Requirement: A top-level page resumes local mode after a background initialization completes

When a timed-out initialization later completes in a top-level page that was otherwise eligible for local mode, the next client-side navigation to a different path SHALL perform a full document load of the destination so that it starts local mode normally. The current document SHALL NOT reload by itself. Navigations that keep the same path SHALL remain client-side. The hosted extension bridge, anonymous public bypass, and pages that stopped before creating a database SHALL keep their existing behavior. Resumption SHALL preserve the database filename, data-version state, and pending local mutations.

#### Scenario: Navigation after background completion
- **WHEN** a top-level page fell back to REST after an initialization timeout and its retained initialization has completed
- **AND** the user navigates to a different path
- **THEN** the destination loads as a new document
- **AND** that document opens the local database and requests synchronization

#### Scenario: Background initialization has not completed
- **WHEN** a top-level page fell back to REST after an initialization timeout and the retained initialization has not completed or failed
- **THEN** navigation stays client-side and the page remains on REST

#### Scenario: Same-path navigation
- **WHEN** the retained initialization has completed and a navigation changes only the query or hash
- **THEN** the navigation stays client-side

#### Scenario: Reading is not interrupted
- **WHEN** the retained initialization completes while the user remains on the current page
- **THEN** the current page does not reload

#### Scenario: Extension bridge times out
- **WHEN** the hosted extension bridge times out and its retained initialization later completes
- **THEN** the bridge does not perform a navigation-time document load and keeps REST behavior until it is recreated
