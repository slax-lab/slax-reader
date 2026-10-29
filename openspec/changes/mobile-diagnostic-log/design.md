# Design

## Context

- iOS share (`native/share/ios`) is a separate process without React Native. `ShareViewController.processShareContent` walks attachments, tries the JavaScript preprocessing property list and `public.url` with `try?` (errors discarded), then `ShareCollector.collect` reads `SharedPreferences` (App Group `group.app.slax.reader`), posts `/v1/bookmark/add_url`, and maps every outcome to a fixed English string. Status, server error name, `NSError` code, and timing are lost.
- The activation rule accepts text, one web URL, and one web page (`plugins/with-share.cjs:53`), but extraction handles only the property list and `public.url`; a text-only share ends at "No content to share" with no trace of what was offered.
- Android share (`ShareActivity`) runs in the app process without JS, does its work on a single-thread executor with `HttpURLConnection`, finds the URL with a regex anchored at the start of `EXTRA_TEXT`, and maps exceptions to strings. Its only record is a Firebase event without error detail.
- The server returns `{data: <error name>, message, code}` and collapses most add-URL failures to `ERROR_PARAM` 400; the Cloudflare ray is the key to the server log.
- `expo-file-system` 58 `File.write(content, {append: true})` is an `AsyncFunction` and appends without reading the file; `Paths.appleSharedContainers` exposes the App Group directory the main app is already entitled to.

## Goals / Non-Goals

**Goals:** a complete per-share record on both platforms written by the share target itself; app/OS metadata once per fresh app startup and once per independent native share lifecycle; account-session records; one hidden privacy-filtered viewer/event-only export pipeline; zero effect of background recording on share and sign-in behavior; compact feedback with independent attachment consent; minimal correction of the clear-cache sheet's extra bottom space; private backend delivery with a bounded support download window.

**Non-Goals:** visible About diagnostic controls, current-status/live-sync snapshots or verbose sync JSON, a new schema version, rewriting or deleting historical logs for this correction, detailed startup/migration/crash instrumentation beyond `app.launch`, fixing share URL/content-type gaps or server error mapping, automatic remote upload, logging sync/purchase/reader events, public diagnostic buckets, new runtime dependencies, unrelated sheet redesign, production deployment, or live notification-group messages. Logs remain local by default; backend upload requires independently checked feedback consent.

The latest explicit user request supersedes earlier visible About viewer/share and snapshot requirements. Historical completed tasks and TF795 evidence remain historical, not requirements to restore those behaviors. These corrections do not establish human hands-on acceptance or a new version/release decision.

## Decisions

### Share session recorder (iOS)

A `ShareDiagnostics` value owned by `ShareViewController` accumulates fields in memory as each stage runs and is written exactly twice: `share.start` in `viewDidLoad`, and `share.end` once, guarded by a flag, from whichever terminal path runs first (success shown, error shown, or `dismissExtension`/`viewDidDisappear` → `dismissed`). Extraction records the offered type identifiers per attachment, which loader produced the URL, and the error domain/code of each failed `loadItem` instead of discarding it. `ShareCollector.collect` returns a `ShareResult` carrying stage, reason, HTTP status, parsed `data`/`code` from the error body, `CF-Ray`, `NSError` domain/code, and durations; the user-facing string is derived from it exactly as today, so messages do not change. `SharedPreferences.read` reports which store was read (`v1`, `legacy`, `none`) and the error class.

Writing uses a private serial utility `DispatchQueue`: `open(O_WRONLY | O_APPEND | O_CREAT)` on `diagnostics/YYYY-MM-DD.share-ios.ndjson`, one `write` of the whole line, `close`. `O_APPEND` single writes keep lines intact if two share instances run at once. The daily allowance is checked with one `stat`. All errors are ignored. The main thread only builds a small dictionary and enqueues.

### Network phase timing

The question support needs answered is which layer is slow when a share save fails: DNS, TCP connect, TLS, server wait, or transfer.

- iOS: the request session gets a task delegate implementing `urlSession(_:task:didFinishCollecting:)`. Each `URLSessionTaskTransactionMetrics` (up to 3) is reduced to `dns`, `connect`, `tls`, `send`, `wait` (request end → response start), and `receive` milliseconds, plus `reused`, `proxy`, `protocol` (`networkProtocolName`), `tls` version, `cellular`, `expensive`, `constrained`, and `remotePort`. Metrics arrive for failed and timed-out tasks too; the terminal record waits for them at most 300 ms after the task completes and is written without them otherwise. For a failure, the failing phase is the first phase with a start date and no end date. The `NSError` underlying error (`_kCFStreamErrorDomainKey`/`_kCFStreamErrorCodeKey`) is recorded with the top-level code so DNS, POSIX, and TLS causes are distinguishable.
- Android: the share request moves from `HttpURLConnection` to OkHttp 4.9.2 (already used by `slax-platform`) with the same timeouts (connect 8 s, read 15 s, write 15 s), no redirects, HTTP/1.1 only, route retry on connection failure (matching the platform `HttpURLConnection`; the one-shot body is never replayed after it is sent), and `Call.cancel()` on dismissal. Error bodies are read only for 400, where the existing message path already reads them; other statuses record status and `CF-Ray` only. A per-call `EventListener` records `dnsStart/End`, `connectStart/End`, `secureConnectStart/End`, request and response header and body events, `connectionAcquired` (reuse), `protocol`, TLS version, and the event in progress when `callFailed` fires. `ACCESS_NETWORK_STATE` is added so the record can include transport (wifi/cellular), validated, and metered flags.
- Observations already visible in code that the timing will confirm or rule out: the iOS session is `ephemeral` and created per share, so every share pays full DNS + TCP + TLS; iOS `timeoutIntervalForRequest` is 8 s while Android's read timeout is 15 s, so a slow server first byte fails only on iOS; the server resolves Twitter short links synchronously before responding.

### Share session recorder (Android)

The same fields and reason codes, built inside `processShare` and the catch blocks, written with `FileOutputStream(file, true)` on the existing executor to `filesDir/diagnostics/YYYY-MM-DD.share-android.ndjson`. The dismissal path records `dismissed` with the current stage. Android adds intent action, MIME type, text length, `urlIndex` (position of the first `http(s)://` in the text, `-1` if none, so the anchored-regex miss is visible), subject presence, and `referrer` package.

### Reason codes

`no_extension_context`, `no_url_found`, `attachment_load_failed`, `unsupported_intent`, `empty_text`, `prefs_unavailable`, `prefs_corrupt`, `signed_out`, `no_token`, `endpoint_missing`, `http_401`, `http_400`, `http_429`, `http_5xx`, `http_other`, `network_offline`, `network_dns`, `network_timeout`, `network_tls`, `network_other`, `cancelled`, `success`.

### Main app logger

`react-native-logs` provides the logger API with `async: true` (scheduled with `requestIdleCallback`). Its bundled `fileAsyncTransport` is not used: with the new `expo-file-system` API it performs synchronous open/seek/write/close per line on the JS thread, keeps an unbounded queue, has no retention, and produces unpadded date names. An app-owned transport takes the structured `rawMsg`, keeps a bounded queue (200, drop oldest with a counter), and a single flusher appends batches with `File.write(lines, {append: true})` after 2 s or on background; 3 consecutive failures disable it for the process. `react-native-file-logger` was rejected: iOS rolls 24 h from file creation, disk quota is forced to 0, Android writes synchronously on the module thread, it captures `console` by default, adds CocoaLumberjack/SSZipArchive/logback, and cannot run in the share extension.

Account records: `SessionController` receives an optional `DiagnosticSink` (no-op default) and records `accept`, `signOut`/`clearIfMatches` with cause, and `rejectIfMatches` once per epoch. `SlaxApi` gets an optional failed-exchange observer; the adapter records only login, refresh, delete-account, and 401 exchanges with allowlisted headers.

### Files and retention

iOS: all sources write to the App Group `diagnostics/` directory (fallback for the app: `Paths.document/diagnostics`, with the viewer noting share records are unavailable). Android: `filesDir/diagnostics/`. Per-source daily allowance 512 KB with one `log_truncated` marker; 30 days within 20 MB, oldest first, pruned once per launch by the main app on a cancellable timer 10 s after the first-interactive mark (React Native 0.88 removed `InteractionManager`). The transport caches the directory and per-day file size in memory, so a normal flush is a single async append. The directory is outside account data, so sign-out and deletion keep these local files. This local policy does not retain remotely uploaded feedback attachments after account deletion.

### Hidden viewer and event-only file export

Remove the visible diagnostic heading, viewer entry, and recent-share entry from About. Five taps on its version remain the only diagnostic-navigation entry: About → Debug → Diagnostic logs. `useDiagnosticLog` lists files and reads selected days lazily; it does not generate or display a current-status snapshot or verbose sync JSON. Remove diagnostic snapshot reads of `database.currentStatus`, `getUploadQueueStats()`, session, and network; ordinary application sync behavior is outside this removal. Viewer/feedback strings remain in `src/i18n/appMessages.ts`, without changing the hash-pinned `messages.ts` baseline.

One export builder writes only real selected, sanitized, time-ordered v1 records to `Paths.cache/diagnostics-export/`. There is no live snapshot, synthetic header, or fabricated event. The recent preset for hidden export and feedback is the current local calendar day plus the prior six local days, not a rolling 168-hour cutoff. Reapply allowlist/redaction and strip historical repeated `app`/`os` from ordinary events, retaining them only on `app.launch` and `share.start`; do not rewrite/delete historical source files. Do not include historical snapshots in newly generated exports. When no exportable records remain, show a localized empty state/actionable no-logs result, create no fake file/event, and do not submit checked feedback without its attachment. Prune stale exports as before and retain active files until consumers finish.

Hidden viewer export uses existing `expo-sharing` `shareAsync` with the actual file URI and NDJSON type. Native targets receive bytes, not path text. Opening Debug/viewer or cancelling native sharing does not upload, submit feedback, or grant consent. Keep source filters, selected-day/recent export, record detail, confirmed diagnostic clear, and localized unavailability/failure feedback.

### Clear-cache sheet geometry

The verified cause is not duplicated bottom insets: `SheetBody`'s `maxHeight: 92%` nested inside auto-sized wrappers caused repeated percentage shrinkage and an approximately 115–125 dp external gap. The minimal fix assigns the existing 92% height cap to the outer bottom-aligned `SourceSheetModal` wrapper and lets the inner sheet use 100%. Keep the deliberate 20 dp plus bottom safe inset exactly once; do not remove intentional padding to mask the height-cap issue. Preserve reachable controls, cache-clear semantics, confirmation, and dismissal on iOS and Android, without a new sheet framework or unrelated redesign.

Verification reported for this correction: 13 mounted cases and 18 native Yoga geometry cases passed, and the independent reviewer found no Important issue. These checks support the implementation task but do not claim device visual verification or human hands-on acceptance.

### Compact feedback and explicit attachment consent

Use a compact bounded multiline input within a scrollable keyboard-aware layout. The submit, cancel, and independent attachment checkbox remain reachable with the keyboard open on small screens; include an explicit localized keyboard-dismiss control that preserves the draft and does not submit. Preserve contextual feedback data, required-field validation, existing success/error/cancellation behavior, and Chinese/English localization.

Each new feedback draft starts with attachment consent unchecked. It is independent of submission, diagnostic recording, and hidden native export, and is not a global preference. The label continues to disclose optional support upload, seven-day retention, and access by anyone holding the link. Unchecked submission uses legacy JSON with no export/upload. Checked submission builds a fresh event-only recent export and validates its size. If there are no exportable logs, or export, validation, upload, or persistence fails, preserve draft/consent and display an actionable error; never fabricate an event or silently omit the attachment. Sending without logs requires deliberate uncheck. Disable duplicate submissions while pending; success clears the submitted draft.

### Additive report API and private R2 storage

Keep authenticated `POST /v1/user/report` and the existing JSON request/response contract for legacy clients and unchecked feedback. Add `multipart/form-data` with exactly one `report` field containing the existing report JSON plus `attach_diagnostic_log: true`, and exactly one file field `diagnostic_log`. Authenticate before accepting an attachment; reject inconsistent consent/file combinations, duplicate file fields, malformed report JSON, and unsupported file content rather than accepting a report without its checked attachment. JSON requests that assert an attachment without a file cannot silently succeed.

Enforce the unchanged 12 MiB (12,582,912-byte) file cap, 64 KiB (65,536-byte) multipart-overhead cap, and 12,648,448-byte total against actual received bytes regardless of `Content-Length`. Accept nonempty event-only v1 NDJSON without a snapshot or mandatory startup header; a selected window can legitimately begin with an ordinary event. Retain compatibility with already-shipped TestFlight build 795 snapshot-leading uploads, including the legacy snapshot-only shape, through the existing sanitized legacy path. This compatibility does not authorize new snapshot generation. Validate UTF-8, supported shapes, ordering of a legacy leading snapshot, and privacy allowlists; do not loosen malformed/unsupported-content rejection. Sanitize both shapes and strip repeated `app`/`os` from ordinary event records. Both accepted input and stored output must fit the existing cap. Reject empty uploads rather than synthesizing content. Do not trust client filenames, MIME declarations, keys, or URLs, and do not store/log rejected raw content. No new record schema version or migration is introduced.

Use only a dedicated private `DIAGNOSTICS` R2 binding, never an existing public asset bucket. Generate the object key and neutral `.ndjson` download filename on the server. Store attachment key, safe filename, sanitized byte count, creation/expiry timestamps, and ownership association in the report's existing `extra_data`; no database schema migration is needed. Await sanitized object upload and report persistence before acknowledging a checked submission. Upload failure creates no successful report; persistence failure cleans up any just-uploaded object and returns an error. Missing binding or signing configuration fails the checked path explicitly while legacy JSON remains usable.

### Signed support download and notification ordering

After upload and persistence, construct a trusted API download URL from server configuration and stored metadata, signed with a separate `DIAGNOSTIC_DOWNLOAD_SECRET` using existing runtime cryptography rather than a new dependency. Bind the signature to diagnostic-download purpose, report/object identity, and a seven-day expiry from upload; do not reuse authentication credentials or let client-provided URLs enter notifications. No full authorization credential, signed download token, or complete signed URL may appear in client/API logs, analytics, errors, or diagnostics.

The dedicated download handler does not require app login: possession of the valid signed link grants access to that one attachment. Before R2 access, verify signature, purpose, expiry, live report/account ownership, and attachment metadata; reject tampered, expired, revoked, deleted, or mismatched references. Stream the private object as `application/x-ndjson` with `Content-Disposition: attachment` using the server-generated filename and a non-cacheable response; do not redirect to a public bucket. A missing object returns a controlled unavailable response.

Deliver the existing notification-group message only after persistence, with the trusted download link when an attachment exists. A notification delivery failure must not turn a persisted report into a submission failure or prompt recreation of the report/upload: retry delivery, if supported, against the existing report identity only. The report remains successfully submitted even when notification delivery fails. No live notification-group message is sent during development validation.

### Remote retention and account deletion

Document and configure a seven-day R2 lifecycle for this dedicated bucket. Application expiry rejects downloads at seven days independently of the lifecycle worker's physical deletion timing. Account deletion revokes download access and removes that account's diagnostic objects as part of the existing deletion flow; preserve the existing notice, confirmation, denial, failure, and sign-out safeguards. Do not rely on the seven-day lifecycle instead of explicit deletion cleanup. Local diagnostic files continue to follow the original 30-day/quota policy.

## Risks / Trade-offs

- [Extension killed before the terminal write lands] → the start record makes the gap visible; the write is enqueued before any dismissal animation.
- [Two share instances write concurrently] → single `O_APPEND` writes per line.
- [Referrer package and URL host are mildly identifying] → kept local by default; user-initiated export or independent feedback consent only, with export/server redaction and no path, query, or title.
- [A support link can be forwarded] → disclose bearer-link access in consent; restrict it to one object and seven days, never log it, keep R2 private, and revoke/remove on account deletion.
- [A checked attachment cannot be prepared or stored] → preserve draft/consent and show failure; never silently omit it. Legacy JSON remains compatible.
- [Notification delivery fails after persistence] → acknowledgement reflects persistence, not delivery; never recreate the report to retry its notification.
- [Server collapses failures to `ERROR_PARAM`] → the ray identifier links to the server log.

## Migration Plan

The original recorder remains additive; reverting it removes recording and leaves inert local files. The feedback API is additive and reuses `extra_data`; deploy/configuration readiness must precede testing checked attachments against a shared environment. Document `DIAGNOSTICS`, the separately provisioned `DIAGNOSTIC_DOWNLOAD_SECRET`, and the seven-day lifecycle without reading or writing secret values. Existing `expo-sharing`, storage, HTTP, and runtime crypto facilities suffice; retain the original logger dependency work but add no new runtime dependency for this revision.

Preserve historical release/build evidence, including TestFlight 795, without treating it as verification of these corrections. Add targeted tests for hidden-only access, cache safe-inset geometry, once-per-start metadata, event-only/empty exports, and backend event-only plus TF795 legacy acceptance; resume the pending native scenarios and local end-to-end feedback/storage/download checks. Record new results and explicit gaps separately in `validation.md` during implementation; this artifact-only edit does not modify that file. Human hands-on acceptance remains pending. The latest request authorizes the exact corrections, not new version approval, deployment, or live group messages.

## Record Contract

All three writers retain the same v1 common fields and source-appropriate event shapes. No schema version bump or historical-file migration is required.

- Directory: iOS `<App Group group.app.slax.reader container>/diagnostics/`; Android `<filesDir>/diagnostics/`. Created on first write.
- File name: `YYYY-MM-DD.<src>.ndjson`, local date, zero-padded; `src` ∈ `app`, `share-ios`, `share-android`.
- Line: one UTF-8 JSON object + `\n`, at most 4096 bytes (oversized lines are dropped, not truncated). Writers never rewrite or read files except to `stat` size.
- Daily allowance: 524288 bytes per file. Before appending, if `size >= 524288` skip; after appending, if the new size `>= 524288`, append one `{"v":1,"ts":…,"src":…,"launch":…,"event":"log.truncated"}` line.
- Retention (main app only, at idle after launch): delete files whose date is older than 30 local days, then delete oldest files until the directory total is ≤ 20971520 bytes.
- Common fields: `v` (1), `ts` (ISO 8601 with local offset, millisecond precision), `src`, `launch` (app: random per fresh startup; share: same as `share`), and `event`.
- Lifecycle metadata: `app` (`"<version> (<build>)"`) and `os` appear only on `app.launch` for the main app or `share.start` for a native share lifecycle. Other events omit them. Historical ordinary-event metadata is stripped in newly generated exports, not deleted from disk.
- A fresh main-app startup produces one `app.launch`; foreground resume, rerender, viewer open, export, account/environment changes, and logger reattachment within that startup do not produce another startup record. An explicit export never fabricates a startup event to avoid an empty result.

### `share.start`
`share` (random 8-hex id), `app`, and `os`, plus common fields. Each native share invocation records its own metadata once even when the main app is closed.

### `share.end`
- Common fields and `share`, with no repeated `app` or `os`.
- `outcome` (`success` | `failed` | `dismissed`), `stage` (`context` | `extract` | `prefs` | `auth` | `request` | `response` | `done`), `reason` (codes listed under Decisions → Reason codes).
- `input`: iOS `{items, attachments, types: [≤10 UTIs], urlFrom: "js"|"url"|null, loadErrors: [{type, domain, code}]}`; Android `{action, mime, textLength, urlIndex, subject: bool, referrer}`. Both add `url: {scheme, host, length}` or `null`, `title: bool`.
- `prefs`: `{store: "v1"|"legacy"|"none", error: <class>|null, signOutPending: bool}`.
- `token`: `{present, len, tail4}`; `tail4` is omitted when the token is 4 characters or shorter.
- `env`: `"PRODUCTION"|"BETA"|"default"`, `host`.
- `http`: `{status, errorName, code, cfRay}` or `null`.
- `error`: iOS `{domain, code, underlyingDomain, underlyingCode, streamDomain?, streamCode?}` (`_kCFStreamErrorDomainKey`/`_kCFStreamErrorCodeKey`); Android `{class}`; or `null`.
- `net`: `{dns, connect, tls, send, wait, receive, total, reused, proxy, protocol, tlsVersion, failedIn}` (milliseconds or `null`); iOS adds `cellular, expensive, constrained, remotePort`; Android adds `transport: "wifi"|"cellular"|"other"|null, validated, metered`. `failedIn` ∈ `dns` | `connect` | `tls` | `send` | `wait` | `receive` | `null`.
- `ms`: `{extract, prefs, request, total}`.
- `shown`: the user-facing message when it is one of the share target's fixed client strings; any server-provided message is recorded as `[redacted]` (the server error name is already in `http.errorName`).

### App events
- `app.launch`: `{app, os}`, once per fresh startup, with common fields.
- `auth.login`: `{provider, ok, http, durationMs, headers: {request, response}}`.
- `auth.signout`: `{cause: "user"|"unauthorized"|"account_deleted"|"environment_switch"|"other"}`.
- `auth.reauth_required`: `{http: {method, path, status, code, cfRay}}`.
- `auth.refresh_failed`: `{http, error}` (non-network failures only).
- `account.delete`: `{ok, canDelete, reason, http}`.
- `log.dropped`: `{count}` written once at the next successful flush after queue overflow.

Header allowlist — request: `User-Agent`, `Content-Type`, `Accept`, `X-CLIENT-TYPE`, `X-CLIENT-VERSION`, `Authorization` (as `{present, len, tail4}`); response: `Date`, `Content-Type`, `CF-Ray`, `Retry-After`, `Server`, `CF-Cache-Status`.
