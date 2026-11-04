# Spec Delta

## Purpose

Bound native share waiting and recover a timed-out creation acknowledgement through the existing bookmark-existence endpoint without adding server behavior or retrying the save.

## ADDED Requirements

### Requirement: Creation has a five-second total deadline

The iOS and Android incoming-share clients SHALL bound an add-URL attempt to five seconds of total elapsed network time. Partial traffic SHALL NOT reset that deadline. Delivered HTTP 200/204 creation headers SHALL permit the existing success outcome without waiting for an unused body. A definitive creation rejection SHALL retain its existing error behavior and SHALL NOT trigger existence recovery merely because its error body stalls.

#### Scenario: Creation response body stalls
- **WHEN** successful creation headers arrive before the deadline but its body stalls
- **THEN** the client displays the existing success state without waiting for the unused body
- **AND** it sends no existence request

#### Scenario: Creation times out without acknowledgement
- **WHEN** creation reaches its five-second total deadline without success or a definitive rejection
- **THEN** the client enters the one-shot existence recheck
- **AND** it does not submit creation again

### Requirement: Recheck uses the existing exists endpoint unchanged

After an ambiguous create timeout, the client SHALL call existing authenticated `POST /v1/bookmark/exists` once, passing the original extracted shared URL as `target_url` with the same captured token and selected API origin. HTTP 200 with JSON `data.exists` equal to boolean true SHALL produce the existing success state. All other lookup outcomes SHALL produce the existing network-timeout message. The client SHALL keep Collecting visible until that decision.

#### Scenario: Existing endpoint reports true
- **WHEN** a timed-out create is followed by a complete HTTP 200 response containing `data.exists: true`
- **THEN** the client displays success
- **AND** exactly one creation and one existence request are initiated

#### Scenario: Existing endpoint reports false or invalid data
- **WHEN** lookup returns false, missing data, malformed JSON, string/number values instead of a boolean, or an unexpected HTTP status
- **THEN** the client displays the network-timeout message
- **AND** it does not retry lookup or creation

#### Scenario: Account and selected environment are preserved
- **WHEN** a share uses the beta API origin and times out
- **THEN** the existence request uses that same origin, authentication, and original shared URL
- **AND** it sends no title and performs no extra URL normalization

### Requirement: Lookup body consumption is bounded

The existence request SHALL have a three-second total deadline covering connection, request, response headers, and the complete JSON response body. A timeout or transport error SHALL NOT be treated as success based on status or partial JSON. Neither body progress nor status receipt SHALL restart the deadline.

#### Scenario: Existence headers arrive but the body stalls
- **WHEN** lookup returns HTTP 200 headers but does not finish its body within three seconds
- **THEN** the client stops the request and displays the network-timeout message
- **AND** the total network waiting remains bounded by five seconds plus three seconds

#### Scenario: Partial response resembles a success document
- **WHEN** lookup delivers JSON-like success bytes without completing the HTTP response before its deadline
- **THEN** the timeout remains unconfirmed rather than success

### Requirement: Backend existence semantics remain unchanged

This capability SHALL reuse the existing `/exists` implementation and response contract without adding an API or special server queries. It SHALL NOT change URL normalization, aliases, deletion/trash handling, Reader-fork readiness, processing states, or authentication semantics. The superseded receipt endpoint and its supporting server additions SHALL be removed.

#### Scenario: Existing lookup behavior affects a shared URL
- **WHEN** the existing endpoint returns true or false according to its current URL, deletion, or Reader-processing rules
- **THEN** native recovery uses that returned boolean as-is
- **AND** no client or server workaround changes those rules

### Requirement: Cancellation and diagnostics retain existing ownership

Dismissal SHALL cancel the currently owned create or lookup request and prevent late feedback or further dispatch. Recovery SHALL retain the original create timeout and network metrics, existing presentation, standalone operation, and exactly one sanitized terminal record. No full URLs, credentials, titles, or response bodies SHALL be added to diagnostics.

#### Scenario: Dismissal occurs during lookup
- **WHEN** the user dismisses while the existence response is pending
- **THEN** lookup is cancelled and no later success/error state is displayed
- **AND** no additional request or terminal record is created

#### Scenario: Existence recovers the timed-out share
- **WHEN** a complete positive existence response recovers the create timeout
- **THEN** the normal success feedback appears without launching the main app
- **AND** diagnostics retain the original create timeout evidence

### Requirement: Approved version metadata remains consistent

The correction SHALL retain the approved Mobile version 1.0.28, build 800, and previous source-build bound 799 across authoritative and generated metadata. It SHALL NOT claim native-build, signing, upload, or publication acceptance from bundle or host-test success.

#### Scenario: Corrected native sources are generated
- **WHEN** the config plugin updates the share source copies
- **THEN** main/share iOS, Android, and runtime metadata remain 1.0.28 (800)
- **AND** no additional version bump is introduced for this scope correction
