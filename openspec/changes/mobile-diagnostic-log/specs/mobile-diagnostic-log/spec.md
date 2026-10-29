# Spec Delta

## Purpose

Local-by-default diagnostic recording for startup, share, and account lifecycles, with hidden viewing/event-only export, compact feedback, and independently consented attachments. The latest user request supersedes earlier visible About diagnostics and live/snapshot-leading export requirements: remove the About diagnostic heading and both actions, remove diagnostic current-status/sync snapshots, and correct the hanging gap beneath clear-cache controls through minimal height-cap and inset ownership changes. The impacted existing `mobile-app-parity` requirement is "Auxiliary behavior is included in completion"; other route/account safeguards remain intact. TF795 legacy upload compatibility and historical evidence are preserved, not an instruction to recreate snapshots.

## ADDED Requirements

### Requirement: Metadata once per lifecycle start

Records SHALL retain schema v1 and common fields `v`, `ts`, `src`, `launch`, and `event`, without a new schema version. Each fresh main-app startup SHALL produce one `app.launch` containing basic app version/build in `app` and OS information in `os`. Ordinary events SHALL NOT repeat `app`/`os`. Native share targets have independent lifecycles: each `share.start` SHALL contain this metadata once and the corresponding `share.end` SHALL omit it. Existing record privacy, bounded writing, and non-interference safeguards SHALL remain unchanged.

#### Scenario: A fresh startup is followed by normal app activity
- **WHEN** the main app starts freshly and then resumes, rerenders, changes account/environment, or opens diagnostics
- **THEN** one `app.launch` identifies that startup with `app` and `os`, with no duplicate startup record for those later actions
- **AND** ordinary event records keep their common v1 fields without repeated app/OS metadata

#### Scenario: A native share runs without the main app
- **WHEN** an iOS or Android share lifecycle starts and finishes
- **THEN** `share.start` carries app/OS metadata once and `share.end` retains its diagnostic result without repeating it

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

Records SHALL be written only for events in this capability: one fresh-startup `app.launch`, one native share lifecycle, or one account action, plus the existing bounded writer's drop/truncation markers. Diagnostic event generation MUST NOT occur in retry loops, timers, watchers, or sync callbacks; opening a viewer/export SHALL NOT create a snapshot or fake event.

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

### Requirement: Hidden diagnostic viewer and event-only export

About SHALL NOT show a diagnostic heading, viewer action, or recent-share action. Five taps on its version SHALL expose Debug, from which the diagnostic viewer and file export remain available. The viewer SHALL list stored days with sizes, support source filtering and record detail, and retain confirmed clear. Diagnostic current-status/live-sync snapshots and verbose sync JSON SHALL NOT be generated, displayed, or included in new exports.

Export SHALL contain only real sanitized selected v1 event records from all sources in time order, with no synthetic header or fabricated event. Recent SHALL mean the current local calendar day plus the prior six local days, including across midnight/daylight-saving transitions; hidden export and consented feedback SHALL share this definition. Reapply allowlist/redaction and remove historical repeated `app`/`os` from ordinary exported records, retaining metadata only on `app.launch`/`share.start`. Historical source logs SHALL NOT be rewritten or deleted for this correction; ordinary retention and user-confirmed clear remain unchanged.

#### Scenario: About opens without revealing diagnostics
- **WHEN** the user opens About normally
- **THEN** no diagnostic heading, viewer button, or recent-share button is present
- **AND** five version taps still open Debug with working diagnostic viewing and export

#### Scenario: Viewer and export operate without current-state snapshots
- **WHEN** the user opens diagnostics or requests selected/recent export
- **THEN** no current-status/sync snapshot is generated or shown
- **AND** the export contains only the real selected app/native-share event records in time order, with no snapshot header

#### Scenario: Existing records contain repeated metadata or sensitive fields
- **WHEN** the export builder reads historical records
- **THEN** unsupported/sensitive values and ordinary-event `app`/`os` repetition are removed from the export while lifecycle-start metadata remains
- **AND** the original on-disk logs are unchanged and no full credentials, bodies, full URLs, titles, free-form errors, or absolute paths appear in the export

#### Scenario: No exportable records exist
- **WHEN** the selected or recent range contains no exportable event records
- **THEN** the viewer shows an explicit empty state and export/checked feedback returns an actionable localized no-logs result
- **AND** no synthetic snapshot, startup event, file placeholder, or attachment-free checked submission is generated

### Requirement: Clear-cache bottom spacing

The clear-cache button/sheet SHALL remain bottom-aligned without a hanging external blank area caused by nested height constraints. Apply only the minimal height-cap and inset ownership correction: keep the existing 92% cap on the outer bottom-aligned wrapper, allow the inner sheet up to 100%, and retain deliberate 20 dp padding plus the bottom safe inset once. Keep controls reachable on both platforms and preserve cache-clear, confirmation, and dismissal behavior. Unrelated sheet redesign SHALL NOT be included.

#### Scenario: Clear-cache sheet is opened with a bottom system inset
- **WHEN** the user opens the clear-cache sheet on iOS or Android
- **THEN** height-cap ownership avoids repeated nested percentage shrinkage and an external gap while intentional padding and the inset remain once
- **AND** the action remains reachable and existing cache/dismissal behavior is retained

### Requirement: Compact keyboard-accessible feedback

Contextual feedback SHALL use a compact bounded multiline input in a scrollable, keyboard-aware layout on iOS and Android. Submit, cancel, and attachment consent SHALL remain reachable while the keyboard is open, including on small screens. An explicit localized keyboard-dismiss action SHALL hide the keyboard without submitting or losing the draft. Existing feedback context, required-field validation, and Chinese/English loading, error, success, and cancellation states SHALL remain functional.

#### Scenario: Feedback is composed with the keyboard open
- **WHEN** the user enters multiline feedback on a small iOS or Android screen
- **THEN** the form can scroll and the consent, submit, and cancel controls remain reachable
- **AND** the explicit dismiss control closes the keyboard without changing or submitting the draft

### Requirement: Independent consent for feedback attachments

Every new feedback draft SHALL present an independent default-unchecked recent-log attachment option. Consent MUST NOT be inferred from logging, hidden native export, or ordinary feedback, and MUST NOT persist as a global preference. Its localized explanation SHALL disclose optional support upload, seven-day retention, and bearer-link access. Unchecked submissions SHALL use legacy JSON without generating or uploading diagnostic files. Checked submissions SHALL prepare a fresh event-only recent export; no logs or any export, validation, upload, or persistence failure SHALL keep draft/consent with an actionable error, never silently omit the attachment. Duplicate submit actions SHALL be disabled while pending.

#### Scenario: Ordinary feedback is submitted
- **WHEN** the user opens a new feedback draft and submits without selecting the attachment option
- **THEN** the option is unchecked and the existing JSON report path sends no diagnostic file
- **AND** neither export generation nor diagnostic R2 upload occurs

#### Scenario: A checked attachment cannot be submitted
- **WHEN** there are no exportable logs or attachment export, size validation, upload, or report persistence fails
- **THEN** the draft and checked option remain available with a visible actionable error
- **AND** the client does not fabricate records or submit without an attachment unless the user deliberately unchecks the option

### Requirement: Hidden diagnostic export shares an actual file

The diagnostic viewer reached through hidden Debug SHALL share selected/recent event-only NDJSON via existing `expo-sharing`. Native targets SHALL receive the actual file, not a path/text-only message. Sharing SHALL NOT submit feedback, upload to the backend, or grant attachment consent. No logs, unavailable native sharing, and export failure SHALL show localized actionable feedback; cancellation SHALL leave the app usable.

#### Scenario: The user shares logs through Debug
- **WHEN** the user opens diagnostics through Debug and exports an available selected/recent range to a native destination
- **THEN** the destination receives a readable file containing only the actual sanitized event records, with no snapshot
- **AND** no feedback report or backend diagnostic upload is created

#### Scenario: Native sharing is cancelled or unavailable
- **WHEN** the user cancels the share sheet or the platform cannot share the generated file
- **THEN** cancellation returns without submission, and unavailability is explained without claiming a file was shared

### Requirement: Additive authenticated diagnostic report upload

Authenticated `POST /v1/user/report` SHALL preserve the existing JSON report contract and add multipart fields `report` (one JSON value containing `attach_diagnostic_log: true`) and `diagnostic_log` (one file). The API SHALL reject unauthenticated attachment requests, missing or inconsistent consent/file combinations, duplicate file fields, malformed report JSON, and invalid diagnostic content. The file limit SHALL be 12 MiB (12,582,912 bytes), with at most 64 KiB (65,536 bytes) of multipart overhead and 12,648,448 bytes total. Actual received bytes SHALL be bounded regardless of missing or inaccurate `Content-Length`.

The API SHALL accept nonempty event-only v1 NDJSON without requiring a snapshot or a startup event at its beginning. It SHALL retain backward compatibility with already-shipped TestFlight build 795 snapshot-leading uploads, including the prior snapshot-only shape, without making new clients generate snapshots. UTF-8, supported shapes, legacy leading-snapshot placement, allowlist/redaction, and existing limits SHALL remain validated. Ordinary event records SHALL be sanitized without repeated `app`/`os`; lifecycle-start metadata SHALL be retained. Empty files SHALL fail rather than receive synthetic content. Invalid encoding, malformed lines, and unsupported shapes SHALL fail the checked submission. Client filenames, MIME claims, keys, and URLs SHALL NOT be trusted; sanitized output SHALL fit the cap and rejected raw content SHALL NOT be stored/logged. There SHALL be no schema version bump or new runtime dependency.

#### Scenario: Current client sends event-only records
- **WHEN** an authenticated consented upload contains valid v1 event-only NDJSON within the limits, including a range beginning with an ordinary event
- **THEN** it is accepted without requiring or synthesizing a snapshot/startup header

#### Scenario: Already-shipped TF795 client sends a legacy attachment
- **WHEN** a consented TestFlight 795 upload uses the valid legacy leading snapshot followed by records or the prior snapshot-only shape
- **THEN** the server accepts it through the sanitized compatibility path with existing privacy/size checks
- **AND** this compatibility does not reinstate client snapshot generation, display, or new-export behavior

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
