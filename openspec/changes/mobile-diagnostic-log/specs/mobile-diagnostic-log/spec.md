# Spec Delta

## Purpose

Local-by-default diagnostic recording for share sessions and account sessions in the mobile app and its share targets, so support can explain failed shares, sign-ins, and sign-outs without background upload or recording-time behavior changes. This capability also governs compact contextual feedback, independently consented recent-log attachment delivery, and About sharing of the actual exported file. These scoped additions extend the Feedback/About portions of `mobile-app-parity` requirement "Auxiliary behavior is included in completion" while preserving other route and account safeguards.

## ADDED Requirements

### Requirement: Share session records

The iOS share extension and the Android share activity SHALL each write a start record when the share UI opens and exactly one terminal record per invocation, sharing a random session identifier. The terminal record SHALL contain the outcome (`success`, `failed`, or `dismissed`), the last stage reached, a reason code from a fixed set, and the fields available up to that stage:

- input shape: item and attachment counts and offered content type identifiers on iOS; intent action, MIME type, text length, subject presence, URL position in the text, and referrer package on Android; URL source, scheme, host, and length, and title presence;
- preference state: which preference store was read and the read error class if any; sign-out pending; token presence, length, and last four characters;
- environment and endpoint host;
- request result: HTTP status, server error name and response code, Cloudflare ray identifier, native error domain and code or exception class;
- network phase timing for the add-URL request: DNS lookup, TCP connect, TLS handshake, request send, wait for first byte, and response receive durations; total request duration; whether the connection was reused or went through a proxy; negotiated HTTP protocol and TLS version; on failure, the phase in which the request failed; and on iOS the cellular, expensive, and constrained path flags;
- per-stage durations and the message shown to the user.

The share targets SHALL write these records without the main app running. A start record without a terminal record SHALL indicate that the share process ended before completing.

#### Scenario: Source app offers only plain text
- **WHEN** a share contains attachments that provide neither a web page result nor a URL item
- **THEN** the terminal record has outcome `failed`, reason `no_url_found`, and lists the offered content type identifiers

#### Scenario: Signed-out share
- **WHEN** the shared preferences indicate sign-out pending or contain no token
- **THEN** the terminal record has reason `signed_out` or `no_token` and no request fields

#### Scenario: Server rejects the share
- **WHEN** the add-URL request returns a non-success status
- **THEN** the terminal record contains the HTTP status, the server error name and code, and the Cloudflare ray identifier

#### Scenario: Network failure
- **WHEN** the request fails with a native network error
- **THEN** the terminal record contains the native error domain and code (iOS) or exception class (Android)

#### Scenario: Slow or timed-out request shows the slow phase
- **WHEN** the add-URL request takes longer than usual or times out
- **THEN** the terminal record contains the duration of each completed network phase and the phase in which it was still running or failed

#### Scenario: User dismisses during a stage
- **WHEN** the user dismisses the share sheet before a result is shown
- **THEN** the terminal record has outcome `dismissed` and the stage in progress

### Requirement: Account session records

The main app SHALL record a sign-in result, a sign-out with its cause (`user`, `unauthorized`, `account_deleted`, or `environment_switch`), reauthentication required with the request path that returned 401, and an account deletion result. HTTP fields SHALL include method, path without query, status, response code, and the Cloudflare ray identifier.

#### Scenario: Forced sign-out is recorded with its cause
- **WHEN** a request returns 401 and the session moves to reauthentication required
- **THEN** one reauthentication record and one sign-out record with cause `unauthorized` are written

### Requirement: Record privacy

Records MUST NOT contain access or sync tokens, request or response bodies, full shared or article URLs, titles, page content, free-form server or system error messages, or absolute file paths. Headers MUST be recorded only through an allowlist, and an authorization value MUST be recorded only as presence, length, and last four characters.

#### Scenario: Shared URL is reduced
- **WHEN** a share session is recorded
- **THEN** the record contains the URL scheme, host, and length, never the path, query, or title

### Requirement: Recording frequency

Records SHALL be written only for the events in this capability, each triggered by one share invocation or one account action. Recording MUST NOT occur in retry loops, timers, watchers, or sync callbacks.

#### Scenario: Sync retries produce no records
- **WHEN** sync uploads or the sync stream fail and retry repeatedly
- **THEN** no diagnostic record is written for those attempts

### Requirement: Daily files and retention

Records SHALL be stored in one file per source per local calendar day in a location readable by the main app. Files older than 30 days SHALL be deleted, and the total stored size SHALL stay within a fixed quota by deleting the oldest files first. A source that reaches its daily allowance SHALL stop writing for that day after one truncation marker. Local diagnostic files SHALL survive sign-out and account deletion; remotely uploaded feedback attachments SHALL instead follow the remote retention and account-deletion requirement below.

#### Scenario: Old files are removed after launch
- **WHEN** the app starts and log files older than 30 days exist
- **THEN** those files are deleted after the first screen is interactive

### Requirement: Logging does not affect behavior

Background recording SHALL NOT change any share result, message, haptic, or dismissal timing, any sign-in or sign-out result, or any UI state, and SHALL NOT delay them. Recording calls SHALL return without waiting for file I/O and MUST NOT throw. File I/O SHALL run off the main thread in the share targets and off the JavaScript thread in the app. In-memory buffering SHALL be bounded. Repeated write failures SHALL stop recording for the rest of the process without retrying and without surfacing an error. Explicit user export and feedback attachment actions SHALL report their own failures rather than silently applying the recording-error policy.

#### Scenario: Unwritable log directory
- **WHEN** the diagnostic directory cannot be written
- **THEN** shares and sign-ins complete with their normal results and messages

### Requirement: Diagnostic viewer, snapshot, and export

About SHALL provide a visible action opening the diagnostic log view alongside the native file-sharing action; opening the viewer SHALL NOT require the hidden Debug gesture. The hidden Debug screen SHALL retain its diagnostic log view entry. The view SHALL list stored days with sizes, records filterable by source, and the full record on selection. The view SHALL show a live snapshot read when it opens: sync connection state, last successful sync time, current upload and download error class and status, pending upload count, account and reauthentication state, network state, app version, build, OS version, and environment. The snapshot MUST NOT be written to the log files.

Export SHALL produce one UTF-8 NDJSON file with a freshly read snapshot followed by the selected days' records from all sources in time order, and open the system share sheet when sharing is requested. Recent logs SHALL mean the current local calendar day and the preceding six local calendar days, not a rolling 168-hour window. About and feedback SHALL reuse this recent export definition. Every export SHALL reapply the field allowlist and redaction to the snapshot and stored records; prior on-disk content SHALL NOT bypass privacy checks. Clear SHALL delete all local diagnostic files after confirmation.

#### Scenario: Export merges share and app records
- **WHEN** the user exports the last seven days
- **THEN** the shared file starts with a snapshot captured for that export and contains app, iOS share, and Android share records for the current local day and prior six days in time order
- **AND** records from earlier local dates are excluded, including across midnight and daylight-saving boundaries

#### Scenario: Existing records contain fields outside the export allowlist
- **WHEN** the export builder reads historical records or current snapshot values
- **THEN** unsupported fields and sensitive values are removed or redacted before file creation
- **AND** the file contains no full credentials, bodies, full URLs, titles, free-form errors, or absolute file paths

#### Scenario: No recent records exist
- **WHEN** the user requests a recent export with no records in its date range
- **THEN** the builder produces a valid snapshot-only NDJSON file rather than stale records or a path-only placeholder

### Requirement: Compact keyboard-accessible feedback

Contextual feedback SHALL use a compact bounded multiline input in a scrollable, keyboard-aware layout on iOS and Android. Submit, cancel, and attachment consent SHALL remain reachable while the keyboard is open, including on small screens. An explicit localized keyboard-dismiss action SHALL hide the keyboard without submitting or losing the draft. Existing feedback context, required-field validation, and Chinese/English loading, error, success, and cancellation states SHALL remain functional.

#### Scenario: Feedback is composed with the keyboard open
- **WHEN** the user enters multiline feedback on a small iOS or Android screen
- **THEN** the form can scroll and the consent, submit, and cancel controls remain reachable
- **AND** the explicit dismiss control closes the keyboard without changing or submitting the draft

### Requirement: Independent consent for feedback attachments

Every new feedback draft SHALL present an independent default-unchecked recent-log attachment option. Consent MUST NOT be inferred from logging, About sharing, or submitting ordinary feedback, and MUST NOT persist as a global preference. Its localized explanation SHALL disclose optional support upload, seven-day retention, and access by anyone holding the download link. Unchecked submissions SHALL use legacy JSON without generating or uploading diagnostic files. Checked submissions SHALL prepare a fresh recent export and submit it with the report; export, validation, upload, and report-persistence failures SHALL keep the draft and checked choice with an actionable error, never silently omit the attachment. Duplicate submit actions SHALL be disabled while the request is pending.

#### Scenario: Ordinary feedback is submitted
- **WHEN** the user opens a new feedback draft and submits without selecting the attachment option
- **THEN** the option is unchecked and the existing JSON report path sends no diagnostic file
- **AND** neither export generation nor diagnostic R2 upload occurs

#### Scenario: A checked attachment fails
- **WHEN** attachment export, size validation, upload, or report persistence fails
- **THEN** the draft and checked option remain available for an explicit retry with a visible error
- **AND** the client does not submit an attachment-free replacement unless the user deliberately unchecks the option

### Requirement: About shares an actual diagnostic file

About SHALL offer user-initiated sharing of the fresh recent NDJSON export via existing `expo-sharing`. Native share targets SHALL receive the actual file, not a path or text-only message. This action SHALL NOT submit feedback, upload to the backend, or grant feedback attachment consent. Unavailable native sharing or export failure SHALL show a localized error; cancellation SHALL leave the application usable.

#### Scenario: The user shares logs from About
- **WHEN** the user selects the About diagnostic-sharing action and chooses a native destination
- **THEN** the destination receives a readable NDJSON attachment with the fresh snapshot and recent records
- **AND** no feedback report or backend diagnostic upload is created

#### Scenario: Native sharing is cancelled or unavailable
- **WHEN** the user cancels the share sheet or the platform cannot share the generated file
- **THEN** cancellation returns to the app without submission, and unavailability is explained without pretending a file was shared

### Requirement: Additive authenticated diagnostic report upload

Authenticated `POST /v1/user/report` SHALL preserve the existing JSON report contract and add multipart fields `report` (one JSON value containing `attach_diagnostic_log: true`) and `diagnostic_log` (one file). The API SHALL reject unauthenticated attachment requests, missing or inconsistent consent/file combinations, duplicate file fields, malformed report JSON, and invalid diagnostic content. The file limit SHALL be 12 MiB (12,582,912 bytes), with at most 64 KiB (65,536 bytes) of multipart overhead and 12,648,448 bytes total. Actual received bytes SHALL be bounded regardless of missing or inaccurate `Content-Length`.

The API SHALL validate UTF-8 NDJSON and supported snapshot/record shapes and apply the allowlist/redaction before storage. Invalid encoding, malformed lines, and unsupported record shapes SHALL fail the checked submission. Client filenames, MIME claims, keys, and download URLs SHALL NOT be trusted. Stored sanitized bytes SHALL also fit the cap. Rejected raw content SHALL NOT be stored or logged. The implementation SHALL use existing runtime facilities without new runtime dependencies.

#### Scenario: Legacy JSON client submits feedback
- **WHEN** an authenticated existing client submits a valid JSON report without an attachment
- **THEN** existing validation, persistence, response behavior, and notification behavior remain compatible

#### Scenario: Consent and the multipart file disagree
- **WHEN** the request supplies a diagnostic file without explicit true consent, asserts attachment consent without a file, or supplies multiple diagnostic files
- **THEN** the request is rejected without persisting a successful report or uploading an attachment

#### Scenario: Attachment bytes are invalid or exceed the bound
- **WHEN** the received body exceeds a file or overhead limit, or contains invalid UTF-8, malformed NDJSON, or unsupported record shapes
- **THEN** the request fails with a controlled error and no accepted report or stored raw file
- **AND** absent or inaccurate `Content-Length` does not bypass the limit

#### Scenario: Valid diagnostic content reaches storage
- **WHEN** one consented valid file within both limits is submitted
- **THEN** only the server-sanitized allowlisted NDJSON is stored under a server-generated key and filename

### Requirement: Private storage and durable acknowledgement

Diagnostic attachments SHALL use a dedicated private `DIAGNOSTICS` R2 binding, never a public bucket. The server SHALL generate storage keys and neutral download filenames, and associate attachment metadata and expiry with the authenticated report/account in existing `extra_data` without a schema migration. Successful attachment acknowledgement SHALL wait for both sanitized R2 upload and report persistence. Missing configuration or upload failure SHALL fail explicitly; persistence failure SHALL remove any just-uploaded object rather than acknowledge success.

#### Scenario: Upload and persistence complete
- **WHEN** a valid checked report is submitted
- **THEN** the API acknowledges success only after R2 upload and report metadata persistence both complete
- **AND** the stored report associates the object, sanitized size, safe filename, owner, and seven-day expiry

#### Scenario: Storage or report persistence fails
- **WHEN** upload fails or persistence fails after upload
- **THEN** no successful acknowledgement is returned and any uploaded object from the failed persistence attempt is cleaned up
- **AND** no notification for an accepted report is emitted

### Requirement: Purpose-bound support download links

The server SHALL generate a trusted download link signed with a separate `DIAGNOSTIC_DOWNLOAD_SECRET`, bound to diagnostic-download purpose, report/object identity, and an expiry seven days after upload. Possession of a valid link SHALL grant download without app login; the bucket itself SHALL remain private. The handler SHALL verify signature, purpose, expiry, live ownership/report association, and attachment metadata before streaming the object as `application/x-ndjson` with `Content-Disposition: attachment`, a server-generated filename, and a non-cacheable response. Signed URLs/tokens and full authorization credentials MUST NOT appear in diagnostic, application, or API logs or analytics.

#### Scenario: Support follows a valid link without app login
- **WHEN** a recipient opens a valid unexpired diagnostic download link
- **THEN** the handler streams only its associated private NDJSON file as a downloadable attachment without requiring app authentication

#### Scenario: Link is tampered, expired, revoked, or unrelated
- **WHEN** the signature, purpose, report/object association, expiry, or live ownership check fails, or the object is missing
- **THEN** the handler returns a controlled unavailable or rejected response without exposing another object or redirecting to a public bucket

### Requirement: Notification follows persistence without duplicate reports

The existing notification-group message SHALL be attempted only after report persistence and SHALL include the server-generated trusted attachment link when present. Notification delivery failure SHALL NOT turn a persisted report into a failed submission or create a duplicate report/upload; any delivery retry SHALL refer to the existing report identity. Client-provided attachment URLs SHALL NOT be inserted into notifications.

#### Scenario: Persisted feedback includes an attachment
- **WHEN** upload and report persistence succeed
- **THEN** the notification contains the trusted seven-day download link for that attachment

#### Scenario: Notification delivery fails
- **WHEN** notification delivery fails after report persistence
- **THEN** the API still acknowledges the accepted report and no replacement report or upload is created to retry notification

### Requirement: Remote retention and account deletion

The dedicated diagnostic bucket SHALL have a documented seven-day object lifecycle. Download authorization SHALL expire at seven days independently of physical lifecycle deletion timing. Account deletion SHALL revoke access to and remove that account's uploaded diagnostic objects through the existing deletion flow, without removing existing account-deletion safeguards. The original local-file retention policy SHALL remain separate. Development verification SHALL use non-production storage and a captured notification sink, not a production deployment or live notification-group message.

#### Scenario: Seven-day retention expires
- **WHEN** a diagnostic attachment reaches its seven-day expiry
- **THEN** its download link no longer works even if lifecycle cleanup has not yet physically removed the object
- **AND** the documented bucket lifecycle removes expired objects

#### Scenario: The owning account is deleted
- **WHEN** the account deletion flow completes
- **THEN** its diagnostic download links are revoked and remote objects are removed
- **AND** local diagnostic files remain subject to the original local retention policy
