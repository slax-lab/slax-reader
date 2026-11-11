# Design

## Context

See `proposal.md` for the human's 2026-11-06 correction. These are task endpoints secured by a fixed operator secret, not user-session operations. Native vector processing remains shared with the live path, but a task request never enters the cascading maintenance Workflow.

## Decisions

### Exact task authentication boundary

Use `VECTOR_REFRESH_SECRET` in Core and the operator environment, transmitted only as `X-Vector-Refresh-Secret: <secret>`. Add the four paths below to the existing authentication whitelist without changing its predicate or the JWT, API-key, rate-limit, or trusted-Edge identity flows. Each Controller calls a shared utility to compare the task secret in constant time before path/body parsing or processing. Missing/empty configuration or malformed/missing/wrong credentials deny before SQL or vector work. Reader JWTs, X-API-Key and team-email status cannot substitute for the task key.

Edge retains its ordinary anonymous forwarding path and forwards the custom header unchanged; it does not validate a task key or introduce a task forwarding mode. There is no task-specific middleware branch, `internalRoutes` entry, or standalone request dispatcher. Key-only callers omit Authorization and X-API-Key to use the existing whitelist behavior. The installed itty-router accepts trailing slashes (`/*$` in its route matcher); each Controller therefore checks the secret first and retains its canonical POST-path guard. A valid Reader JWT on `/refresh/` cannot bypass the dedicated secret. Request logging/rate middleware stay in place; no global job lock or new throttling platform is introduced.

The task secret authorizes target maintenance; the body supplies the target identity, not an actor identity. Controllers validate strict positive safe integer numbers and exact fields. Domain processing contains no HTTP/secret logic and uses current repository state to handle missing, removed, empty or ineligible targets.

### Four single-target actions

| Route | Exact body | Only output target |
| --- | --- | --- |
| `POST /v1/bookmark/vector/refresh` | `{user_id, bookmark_id}` | Article `(userId, bookmarkId)` representative and necessary chunks |
| `POST /v1/bookmark/preference/refresh` | `{user_id}` | That user's article preference, including raw/centered records and interest metadata |
| `POST /v1/collection/vector/refresh` | `{collection_id}` | Independent Collection representation |
| `POST /v1/collection/preference/refresh` | `{user_id}` | That user's Collection preference |

No arrays, generic targets, relation/subscription surrogate IDs, `preference` switch or legacy body forms. Article refresh must not refresh its owner's preference or Collections. User preference refresh reads existing source vectors but must not generate them. Collection refresh reads existing member vectors but must not refresh members or subscribers. Missing dependencies stay explicit failures. One logical target may require multiple source reads or chunk writes; one target does not imply one physical vector operation or a global concurrency guarantee.

Reuse `refreshArticles([onePair])`, `refreshUser(userId, kind)` or `refreshCollection(collectionId)` through injected processing. Preserve `Successed`/`Failed` envelopes and truthful native outcomes; a single verification may report `pending`, but no receipt polling or background per-request graph is added. Native acceptance is not a global visibility guarantee. Remove old actor/team-authorized relation wrappers if no production caller remains.

### Sequential operator

The script owns one `pg.Client`, sets a read-only session, uses parameterized bounded keyset queries, and closes in `finally`. Required environment: `VECTOR_REFRESH_DATABASE_URL`, `VECTOR_REFRESH_URL`, `VECTOR_REFRESH_SECRET` (dry-run needs only the database URL). No credential is accepted in CLI arguments, bodies or logs. No env-file loading or login-token fallback.

Stages remain `article → article-preference → collection → subscription`, where `subscription` now means one Collection-preference target per active user, not per subscription row:

- Article: enumerate eligible user-bookmark relations with a relation-ID cursor, but send only raw `{user_id, bookmark_id}`. Preserve separate owners sharing one original. `--ids` and `--after-id` select relation enumeration keys; logs include the actual pair so the distinction is explicit.
- Article-preference: enumerate active users directly by user ID, once per user, including users without history so stale preferences can be cleared. `--ids`/cursor are user IDs; no MAX-bookmark surrogate or article refresh.
- Collection: enumerate owned Collections by Collection ID, preserving explicit closed-Collection cleanup selection.
- Subscription: enumerate active users directly by user ID, including users with no remaining eligible subscriptions. Each user's Collection preference is refreshed once.

`--user` filters the owner/target user; it never expands to unrelated users. `--kind` selects one stage. `--batch` (1–50, default 10) is SQL page size only. Exactly one HTTP request is outstanding; each targets one entity. `--dry-run` only enumerates/logs, without credentials, HTTP, model/index mutation or output files.

Keep connect/SQL/HTTP deadlines and interruption handling. Failed/pending targets are reported with safe structured reasons, later rows continue and the final exit is nonzero. Cursors indicate enumeration, not completion. No checkpoint/results/failed sidecars, automatic retries, server runs or deployment operations.

## Migration and verification

Replace unshipped old body/auth shapes without compatibility aliases. Generate route/DI/env outputs through `pnpm api -- gen:all`; the optional secret declaration belongs in generator source and public documentation contains only the secret name. The operator provisions/rotates the real key privately in Core and the caller only; Edge requires no task secret. Agents do not read or install it. The caller sends X-Vector-Refresh-Secret and omits Authorization and X-API-Key; no task Bearer compatibility remains.

Verify direct Core and ordinary Edge-forwarded key-only requests, Controller rejection before canonical-path/body parsing, unchanged whitelist predicate and ordinary authentication, each single-target side-effect boundary, real Repository queries, sequential script execution and per-user deduplication. Use temporary test secrets and isolated local fixture infrastructure; no production access is required. Earlier login-route and Bearer middleware-gate results are historical, not acceptance for this revision. Current-revision verification remains pending with the delegated test owner.

## Risks and trade-offs

- A task key has cross-user maintenance power: restrict its exposure, fail closed, scope authentication to exact routes, never log it.
- A user's full-history aggregate can still be expensive: requests are sequential and independent; no claim that all users fit a fixed latency budget.
- Live automatic workflows retain their existing behaviour. These HTTP task endpoints do not invoke them or introduce subscriber fanout.
- Security review and production deployment/backfill remain separately classified gates; tests of task authentication are mandatory even while a broad security review is deferred.
