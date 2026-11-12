# Spec Delta

## MODIFIED Requirements

### Requirement: Incoming and outgoing shares preserve source flows

iOS SHALL retain an independently operating share extension with the original identity and shared authentication, Safari preprocessing, and collecting/success/error/cancel states without forcing the main application to open. Android SHALL retain text/plain incoming sharing, URL/subject handling, and original collection feedback. Both platforms SHALL open their existing standalone collection popup and complete collection within it, retaining collecting, success, failure, and dismissal presentation; the Android correction MUST NOT replace that popup with silent background collection or main-application navigation, and MUST NOT change iOS sharing. Android incoming sharing SHALL remain independent of the main application task: sharing from another application MUST NOT launch or foreground the main Slax Reader screen, replace its navigation state, or require an additional visit to Slax Reader to complete an authenticated collection. Completion or dismissal SHALL return to the source application without leaving a separate share entry in Recents. Locking the screen or temporarily backgrounding an in-flight Android share MUST NOT itself cancel collection. Once success is confirmed, the Activity SHALL finish regardless of visibility or lock state and MUST NOT wait for an animation-end callback. Foreground success feedback SHALL retain its existing bounded display interval; leaving the foreground after success SHALL end the popup without waiting for that interval. Resuming after success MUST NOT restore a stale collection popup. The actual terminal result SHALL be recorded before UI feedback, and bounded finish-requested and destroyed diagnostic records SHALL be persisted and retained through export/upload filtering without logging full URLs, titles, response bodies, or credentials. Cleanup MUST NOT overwrite an already recorded success as cancellation. Existing signed-out, failure, and cancellation behavior SHALL remain available within the share flow. A new Android share delivered while the previous popup is still alive SHALL be handled using its own payload in a fresh standalone popup, retiring the previous popup with the existing cancellation semantics. The previous request's callbacks and delayed dismissal MUST NOT affect the replacement popup; retiring a popup does not undo a save already accepted by the server. Outbound article sharing SHALL preserve existing platform-specific title, text, URL, and image metadata behavior.

#### Scenario: Safari shares while the main iOS application is closed
- **WHEN** an authenticated user shares a supported article
- **THEN** the extension collects it and presents the result within the share flow
- **AND** the main application does not need to launch

#### Scenario: WeChat shares with Slax Reader absent from the foreground
- **WHEN** an authenticated user shares a supported article from WeChat while the main Slax Reader screen is closed or backgrounded
- **THEN** collection feedback appears within the standalone share flow without foregrounding the main Slax Reader screen
- **AND** successful dismissal returns to WeChat and creates no separate share entry in Recents

#### Scenario: An existing Slax Reader task is preserved
- **WHEN** the user leaves a Slax Reader screen in the background and then shares an article from another application
- **THEN** collection does not reuse that main screen as its visible backdrop or replace its navigation state
- **AND** reopening Slax Reader after dismissal restores its prior screen

#### Scenario: Android sharing fails or is cancelled
- **WHEN** sharing encounters missing authentication, a request failure, or user dismissal
- **THEN** the existing feedback and cancellation behavior remain inside the standalone share flow
- **AND** dismissal returns to the source without automatically opening the main Slax Reader screen

#### Scenario: The user shares another article after dismissal
- **WHEN** the user completes or dismisses one share and then shares a different article
- **THEN** the second share processes its own URL and subject once with current shared authentication
- **AND** both operations preserve return-to-source behavior without a stale result or additional main-app visit

#### Scenario: Another share arrives while a failure popup remains open
- **WHEN** Android delivers a new share while the previous failure popup is still alive
- **THEN** a fresh standalone popup handles the new payload instead of leaving the previous result in place
- **AND** the main application remains out of the foreground

#### Scenario: Another share replaces a collecting or successful popup
- **WHEN** Android delivers another share while the previous popup is collecting, showing success, or dismissing
- **THEN** the old popup retires using its existing cancellation behavior and the new payload is handled once
- **AND** old result callbacks and delayed dismissal cannot close or overwrite the new popup

#### Scenario: Collection succeeds after the screen locks
- **WHEN** the user locks the screen during an in-flight share and the request succeeds
- **THEN** locking alone does not cancel the request and the successful popup finishes without waiting for UI animation
- **AND** unlocking does not bring back that popup
- **AND** persisted logs contain one success terminal and the related finish-requested and destroyed events

#### Scenario: The screen locks during success feedback
- **WHEN** collection is already successful and the user locks the screen before the foreground success display interval ends
- **THEN** the Activity finishes directly instead of waiting for the delayed or animated dismissal
- **AND** its existing success log is not replaced by a dismissed or cancelled outcome

#### Scenario: A successful close is inspected through exported diagnostics
- **WHEN** the Activity finishes and its diagnostic writer shuts down normally
- **THEN** queued result and lifecycle records are drained to the NDJSON file and survive local/export upload sanitization
- **AND** repeated cleanup writes no duplicate terminal or lifecycle phase and leaks no document or credential data
