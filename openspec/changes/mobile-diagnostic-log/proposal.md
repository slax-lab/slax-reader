# Proposal

## Why

"Sharing to Slax failed" is the report support can least explain today. The iOS share extension and the Android share activity show a fixed English message and then discard everything else: which content types the source app offered, whether a URL was found, whether the shared preferences were readable, whether a token existed, the HTTP status, the server error name, the native error code, and the Cloudflare ray. Sign-in and sign-out problems have the same gap. A bounded, local-by-default, user-exportable diagnostic log gives support a per-share and per-session record without automatic upload or affecting recording-time app behavior. Users can explicitly export through hidden Debug or independently consent to attach recent logs to feedback; ordinary feedback never uploads logs.

## What Changes

- Record one diagnostic session per share invocation in the iOS share extension and the Android share activity: a start line when the share UI opens and one terminal line with the outcome, the stage reached, a reason code, input shape (offered content types, URL source and host, lengths), preference and token state, environment, HTTP status, server error name, Cloudflare ray, native error domain/code or exception class, network phase timing (DNS, TCP connect, TLS, request send, server wait, response receive, connection reuse, protocol, and the phase a failure occurred in), per-stage timing, and the message shown. The share targets write these files themselves; the main app does not need to run.
- Record basic app version/build and OS once per fresh main-app startup in `app.launch`. Retain schema v1 with common `v`, `ts`, `src`, `launch`, and `event`; `app`/`os` are not repeated on ordinary events. Native share targets have separate lifecycles: `share.start` carries their app/OS metadata once and `share.end` excludes it.
- Record sign-in result, sign-out with its cause, reauthentication required, and account deletion result in the main app, with allowlisted and redacted request/response headers.
- Store records as one structured line, one file per source per local day, in the shared App Group container on iOS and the app files directory on Android, keeping 30 days within a fixed storage quota.
- Expose diagnostic viewing and native file export only through five taps on the About version → Debug → Diagnostic logs. Remove all three visible About diagnostic items: heading, viewer action, and recent-share action. Keep per-day listing, source filtering, record detail, selected/recent export, and confirmed clear.
- Remove current-status/live-sync snapshot generation, display, and export, including verbose sync JSON. Export only real sanitized selected records without a synthetic header; strip repeated `app`/`os` from historical ordinary records without deleting old logs. With no exportable records, show an explicit empty state/actionable no-logs response instead of generating a fake event.
- Correct the hanging blank area below the clear-cache button/sheet with a minimal height-cap and inset ownership correction; retain cache actions and dismissal behavior without unrelated redesign.
- Keep feedback compact, scrollable, and keyboard-aware, with explicit keyboard dismissal, reachable submit/cancel controls, and the draft retained on failure.
- Keep an independent, default-unchecked option to attach recent logs to feedback. Recent means the current local calendar day plus the prior six days. Reapply allowlist/redaction at export; checked attachment failures, including no logs, must be visible and never silently downgrade to feedback without logs.
- Extend authenticated `POST /v1/user/report` additively with multipart fields `report` (JSON containing `attach_diagnostic_log: true`) and `diagnostic_log` (one file), preserving legacy JSON requests. Accept event-only v1 NDJSON while retaining compatibility with already-shipped TestFlight build 795 snapshot-leading uploads. Validate/sanitize content, cap the attachment at 12 MiB and multipart overhead at 64 KiB, and await private R2 upload plus report persistence before acknowledging success.
- Store server-generated attachment metadata in existing `extra_data` through a dedicated private `DIAGNOSTICS` R2 binding. After persistence, include a trusted seven-day, purpose-bound download link in the existing notification group message. The link works for anyone holding it without app login, streams a file attachment, uses a separate `DIAGNOSTIC_DOWNLOAD_SECRET`, and is never logged. Document seven-day object lifecycle and account-deletion revocation/removal. Notification failure must not cause a duplicate report.
- Guarantee that background recording cannot change, delay, or fail a share or a sign-in: writes are fire-and-forget on background queues, every recording error is swallowed, incoming share messages and dismissal timing are unchanged, and in-memory buffering is bounded. Explicit export and feedback attachment actions instead expose actionable errors.
- Retain the original `react-native-logs` dependency work; these corrections introduce no new runtime dependencies or schema version.

## Capabilities

### New Capabilities

- `mobile-diagnostic-log`: local diagnostic recording for startup, share, and account lifecycles, record privacy, retention, non-interference, hidden viewer/file export, and consent-only feedback attachment delivery. The scoped corrections remain within this existing change's capability delta.

### Modified Capabilities

- `mobile-app-parity` — impacted existing requirement: "Auxiliary behavior is included in completion". Feedback attachment behavior, hidden diagnostic access, removal of visible About diagnostics, and the minimal cache-sheet geometry correction are intentional changes, not claims of unchanged behavior. Existing routes, localization, feedback context, account safeguards, and incoming share collection behavior/messages remain compatible. No separate parity delta artifact is introduced.

## Impact

- `apps/mobile/native/share/ios`: diagnostic recorder, collector/preferences outcomes, and one-time metadata in `share.start`; `plugins/with-share.cjs` copies native files.
- `apps/mobile/modules/slax-share/android`: original OkHttp 4.9.2 timing and network-state permission work, with one-time metadata in `share.start`.
- `apps/mobile/src`: lifecycle logger, file transport/retention/export, session hooks, hidden Debug viewer, removal of About diagnostics and live snapshots, compact feedback/consent, minimal cache-sheet height-cap and inset ownership correction, multipart transport, routes, and zh/en strings.
- `apps/api` and affected contracts/tests: accept event-only v1 uploads while preserving TF795 snapshot-leading compatibility; retain bounded sanitization, private object storage, signed downloads, notification links, and deletion cleanup using report `extra_data` without a schema migration.
- API configuration remains a rollout prerequisite, not authorization to deploy or send a live notification-group message. Privacy, limits, consent, R2, and signed-link behavior are unchanged by these corrections.
- Retain existing dependencies and historical release evidence. This artifact revision changes no version and records no new version approval; any further release decision remains separate.
- Follow-up changes outside this scope: rejected sync uploads, detailed startup/migration/crash instrumentation beyond the single `app.launch`, purchase and reader events, share URL/content-type gaps, and server internal-error mapping.

## Revision and acceptance status

The latest explicit user request supersedes earlier visible-About viewer/share and live/snapshot-leading export requirements. Those earlier completed tasks remain historical implementation records, not instructions to restore superseded behavior. TestFlight 795 legacy uploads remain compatible. The request authorizes these exact corrections, not human hands-on acceptance or a new release/deployment. Preserve historical evidence and unfinished native acceptance; new corrective tasks remain unchecked until verified. This artifact-only revision is exempt from live verification, not the implementation itself. No version change, production deployment, or live notification-group message is performed or authorized here.
