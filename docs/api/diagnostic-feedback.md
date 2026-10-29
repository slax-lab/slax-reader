# Diagnostic feedback attachments

## Contract

`POST /v1/user/report` requires the existing active-account authentication. Existing JSON reports still return the existing `ok` success envelope and need no diagnostic configuration. JSON cannot assert `attach_diagnostic_log: true`.

The optional multipart form contains exactly one text `report` part (existing report JSON plus `attach_diagnostic_log: true`) and exactly one `diagnostic_log` file. Unknown parts, duplicate parts, missing/false consent, malformed JSON, empty/binary/non-UTF-8 content, unsupported diagnostic shapes, and invalid NDJSON fail without accepting the report. Client filenames, MIME types, keys, and download URLs do not control storage or notifications.

Limits are shared through `@slax-reader/contracts/feedback`: 12,582,912 attachment bytes; 65,536 framing/report bytes; 12,648,448 total bytes. The server bounds the received stream before parsing multipart and does not trust Content-Length. Every line is at most 4,096 UTF-8 bytes including its newline. Nonempty event-only version-1 NDJSON is accepted; its first record can be an ordinary event from a retained-date slice, without a snapshot or startup header. The server reapplies the allowlist and value validation before storage, and sanitized bytes must also satisfy the file cap.

Current writers emit common `v`, `ts`, `src`, `launch`, and `event` fields. App version/build (`app`) and OS (`os`) appear only on `app.launch` or native `share.start`; the server retains their validated metadata and strips repeated `app`/`os` and status/sync fields from ordinary events, including `share.end`. The existing v1 sanitizer still permits omitted lifecycle metadata and launch identifiers from supported legacy records; it does not invent missing values or tighten those historical optional fields. Event-specific required fields, source restrictions, and privacy validation remain unchanged.

Already-shipped TestFlight 795 uploads remain supported: a legacy snapshot may occur once, only as the first record, including a snapshot-only file. Its existing allowlisted fields are preserved and sanitized; ordinary records that follow are compacted. This is input compatibility, not a new schema version or a requirement to generate snapshots. New clients export only actual merged records, never a snapshot, current-status/sync header, or fabricated event. Recent selection (current local day plus six prior local days) is a client responsibility. Empty exports produce an actionable client no-logs result and no checked submission; the API rejects empty uploads rather than creating content.

Multipart submissions use the existing `BOOKMARK_ADD_RATE_LIMITER` with a separate `diagnostic:uid:<id>` key, before body parsing. Existing JSON feedback is not added to that rate limit.

## Storage and acknowledgement

Configure a dedicated private `DIAGNOSTICS` R2 bucket, distinct from `OSS`, with no public R2 endpoint or custom domain. The example binding lives in `deploy/cloudflare/api.toml.example`; add it explicitly to each selected environment because Wrangler bindings do not inherit. Core uses it for upload/download; Edge uses it for queued and scheduled account cleanup. Browser and AI projections exclude it.

Provision `DIAGNOSTIC_DOWNLOAD_SECRET` separately for Core, using at least 32 cryptographically random bytes. Never reuse JWT or sync signing material. Keep values out of tracked files and command output. It is optional at deployment level: a missing bucket, missing/short secret, or invalid configured API origin explicitly fails checked attachments while ordinary JSON remains available. `BACKEND_API_PREFIX` is the trusted HTTPS origin used in notifications; HTTP is accepted only on localhost in development.

Uploads use server-generated UUID keys and neutral filenames. Existing report `extra_data.diagnostic_log` stores attachment ID, key, filename, owner, sanitized byte count, creation time, and seven-day expiry. No schema migration is needed. Acknowledgement awaits object upload and report persistence. A database failure is reconciled against the generated attachment ID: confirmed absent reports trigger object removal; a committed report is reused; an unknown database outcome fails safely without deleting possibly accepted data. If rollback itself fails, a generic token-free error is logged and the lifecycle remains the cleanup backstop.

Notifications are attempted against the persisted report, with a trusted download link and expiry. Failure to deliver does not reject a durable report or create another report/upload. There is no automatic notification retry; an operator retry must use the persisted report identity and must not resubmit the upload.

## Download and privacy

`GET /v1/diagnostics/download?token=<capability>` is intentionally anonymous. It verifies HS256, issuer, audience, purpose, report identity, attachment identity, owner, issued-at and expiry against persisted metadata, and active-account state before reading R2. It does not accept arbitrary object keys or external URLs. Account deletion revokes access immediately through the active-account check; queued/scheduled cleanup removes the account's diagnostic objects and retries failures through existing deletion machinery. All ordinary and attachment-bearing feedback report rows, content, and metadata remain unchanged. Retained attachment metadata supports idempotent cleanup retries but cannot authorize a deleted account's download. This feature does not introduce a feedback-record deletion policy. Local device logs have a separate retention policy.

The response streams NDJSON bytes with a server-generated attachment filename, `private, no-store`, `nosniff`, `no-referrer`, a restrictive content security policy, and no-index headers. Expired, revoked, mismatched, missing, and malformed links return a generic non-cacheable unavailable response.

Signed URLs and complete tokens must not be pasted into logs, analytics, screenshots, or evidence. Application logs use pathnames only; report webhook responses are discarded rather than logged. **Operational impact:** enabling the diagnostic binding makes generated Core/Edge configuration disable automatic invocation logs and traces for the entire Core and Edge Workers, not only diagnostic routes. Explicit application console logging remains governed by the existing settings. This intentionally reduces Worker-wide observability to avoid capturing complete bearer URLs; operators must review this tradeoff before enabling the binding. No deployment or production configuration change is performed by this implementation. Keep diagnostic requests excluded or query-redacted in any separately configured proxy/access logs, Cloudflare Logpush, tail consumers, tracing destinations, and support tooling. Audit these operator-owned sinks before enabling shared-environment uploads. Bearer-link possession grants access; it is not a group-membership check.

## Seven-day lifecycle prerequisite

Before enabling attachments in a shared environment, an authorized operator must add and verify a seven-day object deletion rule for the `diagnostics/` prefix on the dedicated bucket. This is not a deployment authorization. Do not run remote mutations during local development validation.

Using the pinned Wrangler CLI from `apps/api`, the operator command is:

```sh
pnpm exec wrangler r2 bucket lifecycle add <private-diagnostic-bucket> diagnostics-seven-days diagnostics/ --expire-days 7
pnpm exec wrangler r2 bucket lifecycle list <private-diagnostic-bucket>
```

Repeat for separate preview/test buckets. Review existing rules rather than replacing unrelated lifecycle policy. Lifecycle processing can lag expiration; application authorization expires exactly seven days from upload independent of physical deletion. Cloudflare's command and lifecycle references:

```text
https://developers.cloudflare.com/r2/reference/wrangler-commands/
https://developers.cloudflare.com/r2/buckets/object-lifecycles/
```

## Local verification

No real webhook is used by `pnpm api -- test:http`: its disposable Core wrapper captures the existing report card payload, real PostgreSQL stores the report, local R2 stores the sanitized file, and the captured link downloads without app authentication. It also exercises consent/auth rejection, forged/expired links, notification failure without duplicate reports, account deletion, and object removal. The fixture is never part of production entrypoints. This does not replace real Mobile-to-API or human hands-on acceptance.

Generate artifacts without reading private dotenv files:

```sh
SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example SLAX_API_ENV= \
HYPERDRIVE_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture \
LOGS_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture \
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false WRANGLER_SEND_METRICS=false pnpm api -- gen:all
pnpm api -- typecheck
pnpm api -- test test/utils/feedbackRequest.test.ts test/domain/diagnosticFeedback.test.ts
pnpm api -- test:http
```

`SLAX_API_SKIP_DOTENV=1` is an explicit tooling-only opt-out of loading private environment files; normal operator commands retain the existing behavior. Never hand-edit generated registration or runtime type files.
