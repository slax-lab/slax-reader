# mobile-share-save-recovery Specification

## Purpose
Ensure native sharing finishes promptly and can confirm a saved bookmark when the creation acknowledgement is lost or delayed, without resubmitting the save or confusing persistence with completed parsing.

## Requirements

### Requirement: Native create acknowledgement has a total deadline

The iOS share extension and Android incoming-share activity SHALL bound each add-URL attempt to five seconds of elapsed network time from dispatch, including connection establishment, upload, and acknowledgement. Receiving partial network data MUST NOT restart that overall deadline. Receipt of HTTP 200 or 204 from the authenticated creation endpoint SHALL complete the save acknowledgement without waiting for an unused response body.

#### Scenario: Success headers arrive but the body stalls
- **WHEN** the creation endpoint returns HTTP 200 headers before the deadline but does not finish its response body
- **THEN** the share presents the existing success outcome without waiting for the body
- **AND** no confirmation request or second creation request is sent

#### Scenario: No acknowledgement arrives within five seconds
- **WHEN** the creation attempt reaches its five-second deadline without success or a definitive server rejection
- **THEN** the client stops waiting for that attempt and enters URL confirmation
- **AND** partial response traffic does not extend the create budget

### Requirement: Create timeout triggers one bounded confirmation

A create timeout SHALL trigger at most one read-only saved-state confirmation using the extracted shared URL, the same API origin, and the same authenticated owner as the creation attempt. Confirmation SHALL have its own three-second total network deadline. The client SHALL keep the existing collecting state until confirmation finishes, use the existing success state only on a positive confirmation, and otherwise present the existing network-timeout message. It MUST NOT automatically resend the creation request, poll, or schedule background save retries.

#### Scenario: Creation was saved but its acknowledgement was lost
- **WHEN** creation times out and confirmation finds the user's active saved bookmark
- **THEN** the share displays success rather than a timeout
- **AND** exactly one create and one confirmation request were initiated

#### Scenario: Confirmation does not find a saved bookmark
- **WHEN** creation times out and confirmation reports no matching active saved relation
- **THEN** the share displays the network-timeout message
- **AND** it does not claim that the original request can never finish or submit another save

#### Scenario: Confirmation cannot complete
- **WHEN** confirmation encounters a transport error, unsupported response, rejection, or its own three-second deadline
- **THEN** the share exits Collecting with the network-timeout message rather than claiming success
- **AND** total network waiting is bounded by the five-second create and three-second confirmation budgets

#### Scenario: Environment selection is retained
- **WHEN** a share is dispatched against the selected beta API origin and times out
- **THEN** confirmation uses that beta origin and the same captured authentication
- **AND** it does not silently switch environments or use an unauthenticated lookup

### Requirement: Confirmation proves an active owner-scoped save

The confirmation contract SHALL report success only when a matching bookmark and a nontrashed saved relation belonging to the authenticated caller are persisted. It SHALL NOT wait for article processing or workflow completion; pending, parsing, and failed processing states SHALL remain eligible if the active saved relation exists. An already-saved active URL SHALL count as saved regardless of which invocation first created it. Confirmation SHALL NOT create or restore bookmarks, mutate user relations, or create or retry workflows.

#### Scenario: Bookmark exists without the caller's relation
- **WHEN** a matching bookmark row exists but the caller has no saved relation
- **THEN** confirmation does not report saved
- **AND** another user's relation cannot satisfy confirmation

#### Scenario: Bookmark is in the caller's trash
- **WHEN** the only matching relation for the caller is trashed or permanently deleted
- **THEN** confirmation does not report saved
- **AND** lookup does not restore that relation

#### Scenario: Article processing is incomplete or failed
- **WHEN** the matching active saved relation has committed but processing is pending, parsing, or failed
- **THEN** confirmation reports saved without waiting for processing or retrying it

#### Scenario: Reader-link destination is still parsing
- **WHEN** sharing a Reader link has committed the caller's destination and active relation but destination parsing is unfinished
- **THEN** save confirmation recognizes that destination
- **AND** existing Reader navigation or fork-readiness behavior for other callers remains unchanged

### Requirement: Confirmation uses creation URL identity without changing legacy lookup

Confirmation SHALL use the same supported URL identity rules as creation, including existing X/Twitter normalization and rewrite behavior, WeChat parameter normalization, and supported Reader-link identity. URL resolution failure SHALL remain unconfirmed rather than produce an invented success. The existing bookmark-existence API behavior for clients that do not opt into the new confirmation contract SHALL remain backward compatible.

#### Scenario: A shared URL is normalized before saving
- **WHEN** creation persists an X/Twitter URL with disposable parameters removed or a WeChat URL with its transient token removed
- **THEN** confirmation of the original shared URL locates that same saved identity

#### Scenario: A supported Twitter status alias was rewritten
- **WHEN** creation resolves a supported status alias to a canonical article URL
- **THEN** confirmation reuses the creation identity rule rather than testing only the unprocessed alias
- **AND** failure to resolve within the confirmation budget is unconfirmed, not success

#### Scenario: An existing client uses the legacy existence endpoint
- **WHEN** a client makes its existing bookmark-existence request without the new confirmation contract
- **THEN** its request, response shape, and lookup semantics remain unchanged

### Requirement: Definite errors and cancellation retain ownership

Validation failure, missing authentication, explicit non-success creation status, and non-timeout transport failures SHALL retain their existing error behavior without triggering saved-state recovery. An explicit creation rejection SHALL NOT become recoverable merely because its optional error body stalls. Dismissing either native share surface SHALL cancel the currently owned operation and prevent subsequent confirmation, stale result presentation, or additional terminal outcomes.

#### Scenario: Creation is explicitly rejected
- **WHEN** the creation endpoint returns an authentication, parameter, rate-limit, or server-error status
- **THEN** the share follows its existing status-specific failure behavior
- **AND** it does not turn an older saved bookmark into success through confirmation

#### Scenario: User dismisses while creation or confirmation is pending
- **WHEN** the user dismisses the share UI during either network phase
- **THEN** the active operation is cancelled
- **AND** no later callback displays success or error, dispatches another request, or adds another terminal record

### Requirement: Recovery preserves standalone UX and diagnostic evidence

Both native share surfaces SHALL retain their existing presentation, successful dismissal behavior, input extraction, and standalone operation without starting the main app. Each invocation SHALL retain exactly one sanitized terminal diagnostic record. Recovery SHALL preserve the original create timeout and network timing evidence instead of overwriting it with the confirmation request's measurements; diagnostics MUST NOT record full URLs, titles, credentials, or response bodies and MUST NOT delay user feedback.

#### Scenario: Recovery succeeds with the main app closed
- **WHEN** an authenticated share recovers a timed-out save while the main app is closed
- **THEN** the existing share UI displays success without opening the main app
- **AND** its single terminal diagnostic reflects the final outcome while retaining the original create timeout evidence

### Requirement: Approved Mobile version increment is consistent across native targets

This change SHALL advance Mobile from version 1.0.27 and build 799 to version 1.0.28 and build 800, with the previous source-build bound advanced from 798 to 799. Main iOS, iOS share extension, Android, and runtime version metadata SHALL agree after generation through the repository tooling. These metadata changes SHALL NOT be presented as evidence of signing, upload, publication, or store acceptance.

#### Scenario: Updated metadata is generated
- **WHEN** native projects and runtime configuration are generated for this change
- **THEN** the main app and share extension expose version 1.0.28 and build 800, and Android uses versionCode 800
- **AND** previousBuildNumber is 799 in the authoritative manifest
