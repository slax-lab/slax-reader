# Proposal

## Why

"Sharing to Slax failed" is the report support can least explain today. The iOS share extension and the Android share activity show a fixed English message and then discard everything else: which content types the source app offered, whether a URL was found, whether the shared preferences were readable, whether a token existed, the HTTP status, the server error name, the native error code, and the Cloudflare ray. Sign-in and sign-out problems have the same gap. A bounded, local-by-default, user-exportable diagnostic log gives support a per-share and per-session record without automatic upload or affecting recording-time app behavior. Users can explicitly share the file from About or independently consent to attach recent logs to feedback; ordinary feedback never uploads logs.

## What Changes

- Record one diagnostic session per share invocation in the iOS share extension and the Android share activity: a start line when the share UI opens and one terminal line with the outcome, the stage reached, a reason code, input shape (offered content types, URL source and host, lengths), preference and token state, environment, HTTP status, server error name, Cloudflare ray, native error domain/code or exception class, network phase timing (DNS, TCP connect, TLS, request send, server wait, response receive, connection reuse, protocol, and the phase a failure occurred in), per-stage timing, and the message shown. The share targets write these files themselves; the main app does not need to run.
- Record sign-in result, sign-out with its cause, reauthentication required, and account deletion result in the main app, with allowlisted and redacted request/response headers.
- Store records as one structured line, one file per source per local day, in the shared App Group container on iOS and the app files directory on Android, keeping 30 days within a fixed storage quota.
- Add a "Diagnostic logs" entry to the existing hidden Debug screen (five taps on the About version) with a per-day list, source filter, record detail, a live snapshot of sync and account state, export through the system share sheet, and clear.
- Make contextual feedback compact, scrollable, and keyboard-aware, with an explicit keyboard-dismiss action and reachable submit/cancel controls on both platforms. Keep the draft on failure.
- Add an independent, default-unchecked option to attach recent logs to feedback. Recent means the current local calendar day plus the prior six days, with a fresh snapshot and allowlist/redaction applied again at the export boundary. Checked attachment failures must be visible and must never silently downgrade to feedback without logs.
- Add two visible About actions: open the diagnostic log viewer directly, and use existing `expo-sharing` to share the actual recent NDJSON file, not its path or text. The user explicitly requires both entries; neither requires the hidden Debug gesture, submits feedback, or uploads to the backend.
- Extend authenticated `POST /v1/user/report` additively with multipart fields `report` (JSON containing `attach_diagnostic_log: true`) and `diagnostic_log` (one file), preserving legacy JSON requests. Validate/sanitize UTF-8 NDJSON, cap the attachment at 12 MiB and multipart overhead at 64 KiB, and await private R2 upload plus report persistence before acknowledging success.
- Store server-generated attachment metadata in existing `extra_data` through a dedicated private `DIAGNOSTICS` R2 binding. After persistence, include a trusted seven-day, purpose-bound download link in the existing notification group message. The link works for anyone holding it without app login, streams a file attachment, uses a separate `DIAGNOSTIC_DOWNLOAD_SECRET`, and is never logged. Document seven-day object lifecycle and account-deletion revocation/removal. Notification failure must not cause a duplicate report.
- Guarantee that background recording cannot change, delay, or fail a share or a sign-in: writes are fire-and-forget on background queues, every recording error is swallowed, the incoming share sheet's messages and dismissal timing are unchanged, and in-memory buffering is bounded. Explicit export and feedback attachment actions instead expose actionable errors.
- Retain the original `react-native-logs` dependency work; these additions introduce no new runtime dependencies.

## Capabilities

### New Capabilities

- `mobile-diagnostic-log`: local diagnostic recording for share sessions and account sessions, record privacy, retention, non-interference, hidden viewer/export, About file sharing, and consent-only feedback attachment delivery. The scoped additions are specified within this existing change's capability delta.

### Modified Capabilities

- `mobile-app-parity` — impacted existing requirement: "Auxiliary behavior is included in completion". Feedback layout and optional attachment behavior, About sharing, and diagnostic entry behavior are intentionally extended by the scoped requirements in `mobile-diagnostic-log`, not claimed unchanged. Existing routes, localization, feedback context, account safeguards, and incoming share collection behavior/messages remain compatible. No separate parity delta artifact is introduced by this revision.

## Impact

- `apps/mobile/native/share/ios`: new `ShareDiagnostics.swift`; `ShareViewController`, `ShareCollector`, and `SharedPreferences` report structured stage results; `plugins/with-share.cjs` copies the new file.
- `apps/mobile/modules/slax-share/android`: `ShareActivity` moves its request from `HttpURLConnection` to OkHttp 4.9.2 (already in `slax-platform`) for phase timing and records the same session fields on its existing executor; the Android manifest adds `ACCESS_NETWORK_STATE`.
- `apps/mobile/src`: diagnostics module (logger, file transport, retention, snapshot, export), session and API outcome hooks, Debug sub-screen, About file sharing, compact feedback UI and consent, multipart transport, route, zh/en strings.
- `apps/api` and affected API contracts/tests: additive report handling, bounded NDJSON validation and sanitization, private diagnostic object storage, signed download handler, notification link, and account-deletion cleanup; reuse report `extra_data` without a schema migration.
- API environment/deployment documentation and configuration: dedicated `DIAGNOSTICS` binding, separate download secret, and seven-day object lifecycle; configuration is a rollout prerequisite, not authorization to deploy or send a live group notification.
- `apps/mobile/package.json` and `pnpm-lock.yaml`: original `react-native-logs` work only; reuse existing `expo-sharing` and add no runtime dependency for the additions.
- Mobile app version stays unchanged pending an explicit human decision before implementation handoff, commit, or push; no version approval is recorded here.
- Follow-up changes, not in this one: rejected sync uploads, startup/migration/crash, purchase, and reader events; the share URL-detection and content-type gaps the new records are expected to confirm; the server's 400 mapping of internal errors.

## Revision and acceptance status

The user's direct request authorizes these three additions to the active implementation scope. An automatically approved implementation plan is not human proposal review or hands-on acceptance. Existing completed tasks retain their history; pending native validation, the added client/API verification, human hands-on acceptance, version decision, and pre-push review remain open. This artifact-only revision is exempt from live verification; that exemption does not apply to the behavior implementation. No production deployment or live notification-group message is authorized by this revision.
