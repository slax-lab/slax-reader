# Proposal

## Why

Historical vector refresh is an operator task, not an end-user action. The human explicitly requires a fixed task-specific secret, direct entity identifiers, and exactly one logical refresh target per request to bound load.

## Authorization

On 2026-11-06 the human replaced the prior Reader-login/team-email, relation-row ID and combined article/preference contract. This latest instruction authorizes changing the unshipped refresh endpoints and their local caller in the existing worktree. Older three-action and optional-preference decisions are superseded, not retained as compatibility modes. No production secret creation, configuration edit, deployment, data refresh, commit or push is authorized.

## What Changes

- **BREAKING:** all four vector task actions require `X-Vector-Refresh-Secret: <VECTOR_REFRESH_SECRET>`, not a task Bearer, Reader JWT or API key. The operator configures the same fixed secret in Core and the caller; Edge needs no task secret. Missing or wrong secrets fail closed at Controller entry before body processing.
- **BREAKING:** `POST /v1/bookmark/vector/refresh` accepts `{user_id, bookmark_id}` and refreshes only that private article. Remove `user_bookmark_id` and the `preference` flag.
- Add `POST /v1/bookmark/preference/refresh` accepting `{user_id}`, refreshing only that user's article preference from existing article vectors.
- `POST /v1/collection/vector/refresh` accepts `{collection_id}` and refreshes only that Collection from existing member vectors.
- **BREAKING:** `POST /v1/collection/preference/refresh` accepts `{user_id}`, refreshing only that user's Collection preference. Remove subscription-row surrogates.
- Keep generated Reader routing, existing Bookmark/Collection Controllers, injected Domain processing, Repository SQL and standard lifecycle. Add only these four paths to the existing whitelist; do not change middleware predicates, ordinary authentication or Edge forwarding modes. Each Controller invokes a shared secret-check utility before parsing. This latest human correction supersedes the earlier Edge/Core task-middleware gate; no compatibility mode or generic dispatcher is retained.
- Update the local caller to issue sequential, single-target requests using the task secret. Enumerate each user's two preference targets once directly by user ID; do not re-embed an anchor article or repeatedly refresh per subscription.

## Capabilities

### New Capabilities

- `vector-bulk-sync`: Fixed-secret, single-target vector maintenance and bounded sequential operator enumeration.

### Modified Capabilities

None. Live automatic maintenance and native-vector Repository placement are owned by `vector-v5-recommendation`; no overlapping delta is introduced.

## Impact

Refresh handlers, scoped authentication, the operator script and generated registrations/types change. The operator must set `VECTOR_REFRESH_SECRET`; code and public examples contain only its name. There is no new schema, database role, queue, lock, scheduler, receipt/checkpoint platform or external dependency. Article identity remains private to `(userId, bookmarkId)`. Recommendation, ordinary user authentication and live maintenance behaviour are unchanged.

## Evidence Boundary

Prior login-based and Authorization-Bearer Edge/Core middleware-gate tests are historical evidence only. The latest correction supersedes both: existing whitelist forwarding reaches a Controller-entry X-Vector-Refresh-Secret check, with the server secret configured only in Core. Verify direct Core and ordinary Edge-forwarded requests, rejection before path/body parsing, unchanged middleware behavior, direct target semantics, no dependent writes, sequential caller execution and failure reporting on this revision before claiming acceptance. Current-revision checks remain pending with the delegated test owner; earlier green counts do not close them. Real production backfill remains the human's action.
