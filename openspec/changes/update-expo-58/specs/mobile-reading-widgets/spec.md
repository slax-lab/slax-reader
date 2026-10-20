# Mobile Reading Widgets

## Purpose

Provide compact reading entry points and a finite reading-session activity using safe account-scoped snapshots instead of independent authentication or database ownership.

## ADDED Requirements

### Requirement: Home widgets reflect the active unread library

The widget prototype SHALL support iOS small/medium and Android home surfaces with an eligible unread count and a suggested queue of up to three most recently saved unread, unarchived, non-deleted bookmarks. “Today” SHALL describe this suggested queue rather than a separate due-date system. Widgets SHALL distinguish signed-out, empty and retained-data states and show the snapshot update time. Content titles SHALL require explicit system-surface opt-in; count-only presentation SHALL also require user enablement.

#### Scenario: Reading state changes locally
- **WHEN** an admitted local bookmark is saved, read, archived or deleted
- **THEN** the next published snapshot updates the eligible count and queue
- **AND** Mobile requests a platform refresh without promising an exact background refresh interval

#### Scenario: No eligible content or no signed-in owner exists
- **WHEN** the active account has no unread items or the user is signed out
- **THEN** the widget presents the appropriate empty or sign-in state
- **AND** it does not retain another account's titles or count

### Requirement: Widget snapshots preserve account and runtime boundaries

Widgets SHALL consume atomic, versioned, account-scoped display snapshots without receiving credentials or opening the primary offline database. Publishing SHALL reject stale account/runtime generations. Sign-out, owner replacement and opt-out SHALL revoke old display snapshots. Widget interactions SHALL enter the main application and revalidate current access before opening content.

#### Scenario: A stale publisher finishes after sign-out
- **WHEN** a prior owner's snapshot write or refresh completes after that owner is revoked
- **THEN** the obsolete snapshot cannot replace the signed-out or new-owner state
- **AND** a tap on an old identifier cannot reveal the previous owner's Reader content

### Requirement: Live Activity represents an explicitly started reading session

The iOS prototype SHALL let the user start and stop a finite reading session and show its read/goal counts on supported activity surfaces. It SHALL handle stale data and expiry and terminate on completion, cancellation, sign-out or owner replacement. It SHALL use local updates and SHALL NOT require remote pushes or implement audio/playback controls. Unsupported systems SHALL retain normal reading without an activity.

#### Scenario: Reading session completes or expires
- **WHEN** the goal is reached, the user stops, the session expires or account ownership changes
- **THEN** the activity ends and pending old-owner updates are ignored
- **AND** the application does not leave an indefinite unread-count activity running

### Requirement: New system targets preserve existing packaging

Widget/activity target generation SHALL preserve the main and Share identities, App Group, matching version/build metadata and standalone Share behavior. New targets SHALL NOT introduce Firebase into Share or require production credentials for offline static/unit checks.

#### Scenario: Native projects regenerate with widgets enabled
- **WHEN** the application generates its widget/activity targets repeatedly
- **THEN** target embedding, source/resource membership and metadata remain correct without duplication
- **AND** the existing standalone Share target still builds independently of Firebase
