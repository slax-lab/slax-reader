# Validation and operator handoff

## Current revision pending — Controller-entry secret correction, 2026-11-06

This section supersedes all operator instructions and acceptance claims below where they describe login credentials or an Authorization-Bearer Edge/Core task gate. Those sections and their test counts/logs are preserved as historical evidence only; they do not certify the current revision. No tests, validation commands, production operations or private-configuration reads were performed during this documentation reconciliation.

Current auth: add only the four refresh paths to the existing whitelist, keep its predicate and ordinary JWT/API-key/rate/trusted-Edge behavior unchanged, and call `requireVectorRefreshSecret(request, ctx.env)` first in each Controller. The shared utility checks `X-Vector-Refresh-Secret` in constant time before canonical-path checks, body parsing and processing. Configure `VECTOR_REFRESH_SECRET` only in Core and the operator process; Edge has no task-key gate or task forwarding mode and forwards the custom header through its existing anonymous path. The caller omits Authorization and X-API-Key. A normal authenticated identity never substitutes for the Controller secret, and task Bearer compatibility is removed.

The four bodies and targets remain `{user_id, bookmark_id}` for one private article, `{user_id}` for article preference, `{collection_id}` for one Collection, and `{user_id}` for Collection preference. Script stages remain article → article-preference → collection → subscription (Collection-preference users), with relation enumeration cursors only for articles and user-ID cursors for both preferences. No cascade, retry/checkpoint platform or new endpoint is authorized.

DeepSeek completed the current custom-header focused run: nine files / 242 tests passed, zero failed or skipped. Command: `pnpm api -- test test/handler/http/vectorTaskRefresh.test.ts test/handler/http/vectorTaskRefreshIntegrated.test.ts test/handler/http/securityBoundaries.test.ts test/entry/edge.test.ts test/script/vectorRefresh.test.ts test/script/vectorRefreshSequential.test.ts test/script/vectorArchitecture.test.ts test/script/generatorPaths.test.ts test/utils/vectorTaskAuth.runtime.test.ts`. Log: `.local/task-auth-verification/focused-x-vector-refresh.log`.

The actual local Miniflare/Workerd test uses Edge/Core fetch, generated routes and Controllers with real node:crypto. Edge has no VECTOR_REFRESH_SECRET; Core valid/missing/empty-config workers are separately exercised. Correct custom-header requests succeed for all four actions, while missing/wrong keys, user JWT alone, API-key-only requests and forged forwarded identity cause no target work. Canonical-path/body checks, early bodyUnused rejection, script exact headers, target isolation and sequential invocation are covered. Repository/source/model/native-index boundaries remain isolated fixtures, not production or cloud access. Public-config generation/typecheck/lint were separately reported by the implementer; these focused tests do not certify the final full tree after subsequent unified-search changes. Full-suite checks remain pending.

Article-marker removal, `no_public_candidates` behavior and the newly authorized unified hybrid search are owned and tracked in `../vector-v5-recommendation/`; this bulk delta adds no duplicate capability requirements or pool endpoint/script.

## Historical fixed-Bearer contract revision — 2026-11-06

The human explicitly replaced all earlier login/team-email and surrogate relation/subscription-ID refresh semantics. The 2026-11-05 instructions below are historical and MUST NOT be used for this revision. Current design/specs define four fixed-task-secret endpoints, each processing exactly one logical target. Verification is pending until the revised implementation and tests finish; old green counts do not certify this contract.

The operator configures `VECTOR_REFRESH_SECRET` privately on Edge and Core and injects that same value into the local caller; it is sent only as an Authorization Bearer header. No real key is generated, read, printed or installed in production by this task. Reader login tokens, API keys, team emails and Edge user identities are not refresh credentials.

| Endpoint | Exact request body | Only target |
| --- | --- | --- |
| POST /v1/bookmark/vector/refresh | `{user_id, bookmark_id}` | One private article and its necessary chunks |
| POST /v1/bookmark/preference/refresh | `{user_id}` | One user's article preference |
| POST /v1/collection/vector/refresh | `{collection_id}` | One independent Collection vector |
| POST /v1/collection/preference/refresh | `{user_id}` | One user's Collection preference |

No request cascades through the live maintenance Workflow or refreshes dependencies. The script retains one outstanding HTTP request and four stages. Article-stage cursors/`--ids` remain relation enumeration keys, but its POST carries the raw user/bookmark pair; both preference stages enumerate user IDs once (including empty-history users), and Collection selection uses Collection IDs. The old MAX-successful-relation preference trick, subscription-row loop and `preference:false` flag are removed. `--batch` bounds SQL pages only.

Required caller environment: `VECTOR_REFRESH_DATABASE_URL`, `VECTOR_REFRESH_URL`, `VECTOR_REFRESH_SECRET`. Dry-run requires only database configuration. The human still owns deployment/backfill/replay; the already-created production Vectorize resources are unchanged, and no production request is authorized by this implementation turn.

For a manual request, configure the secret securely in the environment and send only one target in the JSON body (all IDs below are placeholders, not authorized production targets):

```sh
curl --request POST "$VECTOR_REFRESH_URL/v1/collection/vector/refresh" \
  --header "Authorization: Bearer $VECTOR_REFRESH_SECRET" \
  --header 'Content-Type: application/json' \
  --data '{"collection_id":123}'
```

The article equivalent body is `{"user_id":123,"bookmark_id":456}`. Each preference endpoint accepts `{"user_id":123}`. There is no `preference` switch, no login token and no batch of IDs in an HTTP body. A user article-preference refresh may write raw and centered records for that same user; this is one logical target, not another user's refresh. Serial operator requests limit caller load but do not lock out other independently running clients.

AiEntry now only forwards native vector RPC calls into `infra/repository/vectorIndexRepo.ts`; `getVectorsByIds`, `upsertVectors`, `deleteVectorsByIds` and `queryVectors` replace the unshipped `v5*` method names. The Core/Edge adapter uses the Repository-side RPC interface. Legacy shard query/upsert/delete signatures are preserved, and no production index names or vector values change in this refactor.

### Revised source verification

Production implementation finished before the test handoff. Real `gen:all` ran with public configuration, disabled dotenv loading and placeholder loopback database URLs; typecheck and lint passed. Independent read-only review found no concrete Bugs, Compliance or task-auth fault in this focused revision: the secret gate precedes user authentication in Edge/Core, noncanonical trailing-slash handlers reject before body parsing, each operation processes one target, both preference stages enumerate users once, and native-vector implementation is confined to Repository. This is not a broad Security-review completion, production deployment, runtime acceptance or load guarantee. DeepSeek completed regression and isolated Workerd acceptance after source implementation; results follow.

### Final acceptance for the revised contract

- Final API suite after the Workerd supplement: **3,463 passed, 117 skipped, 0 failed; 229 test files passed and 15 skipped**. Focused task-auth/Edge suites including runtime: 162 passed. The prior focused full revision set contained 379 passing tests across nine files. Skips remain environment-gated and are not counted as passes.
- Typecheck and lint passed (0 errors, 343 existing warnings), strict OpenSpec 92/0, and the current-source four-Worker public-template dry-run build passed. The runtime supplement changed tests only; unchanged source gates were not needlessly rerun or claimed newer. Logs: `.local/task-auth-verification/`, including `full-test-runtime.log` and build/typecheck/lint logs.
- Real runtime supplement: `test/utils/vectorTaskAuth.runtime.test.ts` bundles the actual Edge and Core fetch entrypoints, generated route/DI code, middleware, Controllers and maintenance Service in installed Miniflare/workerd with `nodejs_compat`. A local Worker service binding connects Edge to Core; requests go through workerd loopback HTTP dispatch, not direct Node calls. `createHash`/`timingSafeEqual` execute natively in workerd. Temporary fixture secrets are not deployment credentials.
- External data boundaries remain fixtures: memory Repository rows, source preparation, model responses and native vector operations; unrelated Controller dependencies and database driver imports are isolated. This does not claim real PostgreSQL/Vectorize/Jina access or a deployed secret. PGlite independently exercises operator enumeration. Standard Docker-backed `httpSmoke`/`integrationSmoke` were not rerun; this narrow runtime test is not described as replacing them.
- Both direct Core and Edge pass secret-only requests with no user login for all four actions. Missing/wrong/whitespace keys, API-key-only requests, mismatched Edge/Core keys and spoofed forwarded identity fail. Tail-slash aliases with an otherwise valid Reader JWT reach no maintenance work and are rejected; old bodies fail. Controller request parsing and maintenance counters confirm rejection before target processing.
- Single-target assertions verify no article-to-preference cascade, no Collection-to-members/subscribers cascade, no source embedding on preference refresh, two raw/centered article records as one user target, empty-history cleanup, A/B private isolation and explicit missing dependencies. The CLI's deferred-request tests observe one outstanding HTTP request; both preference stages visit each active user once, including empty-history users.
- Repository migration tests cover native validation, filters, normalization, return flags, descriptive RPC forwarding and unchanged five-shard legacy signatures. No old `v5*` source callers or Entry type dependency remains in the remote adapter.
- Independent scoped Bugs/Compliance/task-auth review found no concrete faults in the reviewed snapshot. This is not completion of the separately deferred broad Security review, unresolved earlier lifecycle issues, production deployment or full-history execution.
- Minor preserved diagnostic limitation: generic reasons containing digits (for example `embedding_http_503`) are currently filtered from CLI output unless they match the structured dependency format. The failure state and nonzero outcome remain accurate; this was not expanded into an unrelated fix.

## Historical operator handoff — 2026-11-05

This section supersedes the historical three-stage commands and internal-route descriptions below. The current implementation has three ordinary authenticated endpoints and four CLI stages. It has not been deployed to production or run against production data. The human owns deployment, full-history refresh and the later production replay.

### Verified local snapshot

- Final default API suite: **3,338 passed, 118 skipped, 0 failed**; typecheck passed; lint 0 errors / 343 existing warnings; strict OpenSpec 92/0. Skips are not passes.
- Current-source `pnpm api -- build --config deploy/cloudflare/api.toml.example` passed all four offline Worker bundles without deployment. Log: `.local/build-verification/api-build-20261105T112416Z.log`.
- Bounded test-account live checks: four-stage operator dry-run and execution, explicit article-only requests, one article-preference call per user, continuation and exact dependency diagnostics. Phase-4 live recheck passed 22/22 across write-path scenarios; the final PDF-AI-suppression and committed-save acknowledgement fixes subsequently passed controlled regression tests, not another cloud replay. See `../vector-v5-recommendation/validation.md` for exact boundaries.

### Before any production run

1. Resolve the open review/release items and review the actual dirty diff; this handoff is not an unconditional production-ready certification. No commit, push, PR, deployment or production backfill was performed. The human later authorized the production index work described in item 2 only.
2. Production account `f74694cd77e247e071af286f40d20116` now has verified V5 resources: the existing `reader-prod-v5-article`, `reader-prod-v5-user` and `reader-prod-v5-collection` indexes (1024 dimensions, cosine; all zero vectors at verification) and newly created, readback-verified required metadata filters (`kind: String`, `user_id: Number`, `recommendable: Bool` on article; `recommendable: Bool` on Collection; none on user). The vector indexes were already created on 2026-11-03 and were not recreated. The operator still configures the corresponding `VECTOR_V5_ARTICLE`, `VECTOR_V5_USER`, `VECTOR_V5_COLLECTION`, maintenance Workflow binding and provider configuration through the existing private deployment process; no private config was changed during index provisioning. `deploy/cloudflare/api.toml.example` documents binding names; its test names must not be used as production targets. Preserve the legacy serving search configuration until a separately reviewed cutover. See the production-index completion section of `../vector-v5-recommendation/validation.md` for exact creation mutations and scope.
3. Inject `VECTOR_REFRESH_DATABASE_URL` (authorized read-only PostgreSQL access), `VECTOR_REFRESH_URL` (API origin only) and `VECTOR_REFRESH_AUTH_TOKEN` (existing Reader login token) through the environment. Do not paste credentials into commands or logs. All-user execution requires the existing team-email authorization; a normal login can refresh only its own records. Privileged cross-user use has local coverage, not a production acceptance run.
4. The CLI does not load environment files, create indexes, migrate schemas, start a server or provide automatic retry/checkpoints. `--batch` is a SQL page size (default 10, range 1–50); HTTP requests are sequential, so it is not a concurrency setting.

### Recommended first run: articles only

Run from the repository root, after the operator deploys and injects the environment variables:

```sh
pnpm api -- vector:refresh --help
pnpm api -- vector:refresh --kind article --batch 10 --dry-run
pnpm api -- vector:refresh --kind article --batch 10
```

For an initial bounded check, add `--user USER_ID`, replacing `USER_ID` with one actual numeric user ID. Article requests use `{ user_bookmark_id, preference: false }`; this stage does not recompute the user's preference. Do not omit `--kind` for this first staged run: without it, all four stages run. Ordinary live mutation hooks still perform their normal maintenance; article-only CLI execution does not disable them globally.

Pause after article refresh to review errors and follow the human's sequencing decision on production replay and provisional recommendation parameters. Agents do not execute that replay. After dependencies and parameter decisions are settled, the later stages are:

```sh
pnpm api -- vector:refresh --kind article-preference --batch 10
pnpm api -- vector:refresh --kind collection --batch 10
pnpm api -- vector:refresh --kind subscription --batch 10
```

`article-preference` selects each user's largest eligible successful `sr_user_bookmark.id` and calls the same bookmark endpoint with its default preference behavior. The already-existing article may be checked/refreshed again, but its user's full preference is computed once in this stage. Subscription stage remains one request per eligible subscription row and can recompute a multi-subscribed user's Collection preference more than once; no broader claim of deduplicating every preference stage is made.

### Failures and manual repair

- Nonzero exit means selected work remains failed or pending. `received` counts recognized responses, not completed/query-visible vectors. Later successes do not erase earlier failures.
- Rerun reported relation IDs with `--kind article --ids ID1,ID2`, or a selected preference row with `--kind article-preference --ids ID`. Replace these placeholders with actual numeric row IDs. For Collection and subscription stages use their corresponding primary keys. A `missing_dependency:a:USER:BOOKMARK` is a vector identity, not a `--ids` relation ID; locate and repair the corresponding relation before rerunning its dependent aggregate.
- `--after-id` is an exclusive enumeration cursor for one stage, not a completion checkpoint. Moving it forward does not repair earlier failures.
- In `article-preference`, `--ids` is applied after selecting the maximum successful relation per user; an arbitrary smaller relation is not substituted. Use dry-run to see the selected IDs.
- Current transport budgets: PostgreSQL connect 10 seconds, SQL statement 30 seconds, each HTTP request 120 seconds. No production throughput/capacity guarantee was measured.

### Remaining limits

Security review, a current cached-media live case, the compound representative-write/cleanup-failure orphan risk, production capacity and the postponed search cutover remain open. Recommendation-specific findings and MIND-derived parameter use remain deferred. The 8 MB / 400-page PDF experiment measured host RSS, not isolate peak heap. Full details remain in the recommendation validation file; these items are not closed by a green test count.

## Historical parent checkpoint — 2026-11-04

The bounded operator implementation and three ordinary action routes are verified. This checkpoint supersedes older snapshot-wide completion wording; historical logs remain preserved.

- Lane-B actual test-account execution processed all seven selected user-8 rows in article → Collection → subscription order: five article relations, Collection7 and subscription15. Each ordinary action's vector scope was checked against native before/after values. Dry-run and keyset/cursor/scoped-ID behavior were verified; a real rejected first row did not prevent the later own row, and final exit1 honestly reported incompleteness.
- Controlled local/PGlite tests verify distinct relation/bookmark/subscription/Collection primary keys, inactive-owner and multiple-subscription behavior, and pending-row continuation. These are not falsely labelled live races or full-history execution. Final pending/PK supplement passed3tests, alongside the190-test supporting group.
- Core native read batching now handles all21/27/41/103 requested IDs in batches<=20 without truncation. Actual27-save history, ordered star/repeat/unstar and private trash/restore with A/B isolation passed after the repair.
- Final default API suite:216filespassed/15skipped,3167testspassed/118skipped. Separate disposable PostgreSQL Fork tests40/40 and media recovery3/3 pass; standard disposable integration10groups passes. Typecheck/lint(0errors)/strictOpenSpec92/0/diffcheck and isolated four-Worker build pass. Environment-gated skips remain identified, not silently counted as passes.
- Corrected live PowerSync, own-snapshot reuse, own-link import and authorized cross-owner HTML Fork/import also completed with actual test-index article vectors and user-preference Workflow steps. Detailed resources, command results and mixed live/local qualifications are in `../vector-v5-recommendation/validation.md` and `.local/vector-live/parallel-A-targeted-verdicts.json`.
- The PDF rule is unchanged-original direct input at<=8,000,000bytes and existing extracted text above that threshold; no large original is read on the text path. Old direct50MiB provider acceptance is superseded, not a remaining operator requirement.

Human/release boundary: no production data access/backfill/deployment, serving-search cutover, commit/push/PR/merge/archive or production capacity promise. Existing account-scoped authorization remains; team-email cross-user allowance has local tests but was not forced with a live privileged fixture. Security review is deferred by explicit user instruction. No CLI/Extension/Mobile shipped-package version change is implicated by this API-only operator; reassess if scope expands.

## Historical test-owner verification — 2026-11-04 (earlier snapshot)

Scope: tests and the bounded local caller only. Branch `fix/android-storage-path-alias`, baseline HEAD `83534757`; no commit, push, deployment, migration, production access or full-history run. Everything below the historical warning is unchanged and remains non-evidence.

### Standard commands on this tree

`gen:all`, `typecheck`, `lint` (0 errors / 343 warnings), `test` (214 files passed / 14 skipped; 3114 tests passed / 114 skipped), four-Worker dry-run `build`, `test:http` (including the admission fixture), `test:integration:local` (10 stages) and `openspec validate --all --strict` (92/0) passed. Details and the 50 MiB PDF measurement are in `../vector-v5-recommendation/validation.md`; they apply to the same tree.

### Local caller against the existing local fixture

The caller used its normal environment-only inputs (`VECTOR_REFRESH_DATABASE_URL`, `VECTOR_REFRESH_URL`, `VECTOR_REFRESH_AUTH_TOKEN`). The token was minted through the existing `Auth` signer from operator configuration for fixture users only; no token or DSN is recorded here and no machine credential or bypass was added.

| Invocation | Observed result |
| --- | --- |
| `pnpm api -- vector:refresh --batch 4 --dry-run` | enumerated 31 rows in article → collection → subscription order using bounded keyset pages; no HTTP, model, index or file write |
| `--kind article --ids 35` | one row: `failed / source_not_ready`, summary `received 1, failed 1`, nonzero exit; HTTP 200 was not treated as completion |
| `--kind article --user 9 --batch 2` | five rows across pages in order `34 written, 35 failed/source_not_ready, 36 written, 37 written, 38 written`; the failed pending row did not stop later rows; summary `received 5, failed 1`, nonzero exit |
| `--kind collection --ids 6` as owner user 7 | `written`, exit 0; the aggregate refreshed only that Collection |
| `--kind collection --ids 7` as owner user 8 | `written`, exit 0 |
| `--kind subscription --ids 11` as its owner user 9 | `written` for the user Collection preference, exit 0 |
| `--kind collection --ids 6,7` as non-owner user 9 | both rows rejected before processing (`refresh_request_failed`); existing owner/team authorization, not a new mechanism |
| `--kind subscription --ids 4` | enumerated 0 because that fixture row no longer existed; it was not guessed or recreated. The current row id 11 was then used |

The CLI prints one JSON line per row and a final summary; pending/failed rows are reported per row, no checkpoint or result files are written, and a non-clean result exits nonzero.

### Declared gaps

- The existing team-email cross-user allowance was not exercised because the fixture accounts are deliberately not in `WHITE_EMAILS`; only owner access and foreign denial were observed live.
- No multi-page run over real historical volume was performed; the PGlite enumeration tests cover keyset paging and the live dry-run covered 31 fixture rows.
- Fixture relation 35 keeps its pending capture claim and remains unresolved (see the recommendation validation).

## Historical evidence only

> Historical recovery evidence only. The content below describes the removed frozen-foundation implementation, not the current main-tree architecture. Its endpoint, receipt/checkpoint contracts, role checks, commands and passing counts are superseded and MUST NOT be used as current instructions or acceptance. The approved stateless CLI and DI/Repository/Service/Controller/Workflow architecture remain without integrated runtime/provider acceptance in this scoped task; current focused script evidence is recorded in `tasks.md`.

## Status and provenance

Bulk API and ID-only CLI are implemented and exercised locally on branch `feat/vector-bulk-sync`, HEAD `8d615ba3`, with the inherited frozen foundation overlay. This is not completed remote acceptance or a migration/read-cutover claim. No commits, pushes, deployment, cloud resource modification or production access occurred.

Frozen manifest SHA256 remains `1e2fff94b504fb1998a439734af20d7cf4cd5b1f3510473a1ba1a679d433b59b`; `foundation-inputs.json` remains `c27dc0e1d61b6c39036b3b8d3de61011d52ffe184d2a85242b1bc829ed900282`. Of its 236 files, 231 match exactly. The five intentional differences are API package commands, Edge/Core route consumers, Edge tests and the local diagnostic Worker. Foundation algorithms, schemas/migrations, Workflow, math, namespaces, identity and source storage are unchanged. Standard generators were run; their frozen outputs still match.

## Implemented contract

`POST /internal/v1/vector-backfill/entities` requires the existing dedicated machine Bearer credential independently at Edge and Core, including direct Core calls. Missing/invalid credentials fail closed. No `VECTOR_REFRESH_ENABLED` exists and `VECTOR_BACKFILL_ENABLED=false` does not prevent this endpoint or enable the old runs/queue/cron platform. JSON body is strictly bounded to 256 KiB, 1–50 unique ID-only targets, generation `jina-v5-r1`, recipe `symmetric-r1` and purpose `historical-refresh`.

Example body (illustrative IDs, not existing remote fixtures):

```json
{
  "purpose": "historical-refresh",
  "items": [
    {"target": {"generation": "jina-v5-r1", "recipe": "symmetric-r1", "entity": {"kind": "article", "id": 101}}},
    {"target": {"generation": "jina-v5-r1", "recipe": "symmetric-r1", "entity": {"kind": "collection", "id": "legacy:7"}}},
    {"target": {"generation": "jina-v5-r1", "recipe": "symmetric-r1", "entity": {"kind": "user_preference", "id": 9, "preference_kind": "article"}}},
    {"target": {"generation": "jina-v5-r1", "recipe": "symmetric-r1", "entity": {"kind": "user_preference", "id": 9, "preference_kind": "collection"}}}
  ]
}
```

Response envelope is `{ protocolVersion: 1, purpose, recipeDigest, done, items }`. Each result contains requested `target`, `state`, `done`, `disposition`, `retryable`, scalar `readiness` and optional safe `reasonCode`, bounded `retryAfterMs`, dependency identity and `{ kind: "shared-checkpoint" }` continuation marker. A retry resubmits the same target, not a client cursor. Original source, manifests, vectors and preference snapshots are never serialized. Article requests use one `foundation.articles` call for the group; aggregates use `aggregate(entity, 2)`.

HTTP 200/207 alone never means ready. `failed`/`partial` remain incomplete; nonretryable failure is not success. Shared aggregate `{complete:false}` and dependency outcomes preserve the requested identity. Valid cold-start/deletion is explicit successful processing without a fabricated zero vector and with `readiness.ready=false`. Point-in-time `verified_as_of/current:false` is preserved. A committed fallback is not falsely labeled materialized.

## CLI usage and least privilege

Have the operator inject `VECTOR_REFRESH_DATABASE_URL` and `VECTOR_BACKFILL_TOKEN` into the process using their existing secret tooling; do not put either value in argv or files. No `.env` or `.dev.vars` is loaded by this CLI. Only SELECT access to the required Reader identity/eligibility tables is needed, with no write grants, ownership, superuser or role-management rights. A read-only session is also enforced and catalog privilege checks reject a writable role. The real local acceptance verifies that SQL UPDATE is denied by the role itself.

From the repository root, after environment injection:

```sh
pnpm api -- vector:refresh --help
pnpm api -- vector:refresh --origin https://TEST_API_ORIGIN --user 123 --batch-size 10 --dry-run
pnpm api -- vector:refresh --origin https://TEST_API_ORIGIN --user 123 --batch-size 10 --state .local/vector-refresh-test.json
pnpm api -- vector:refresh --origin https://TEST_API_ORIGIN --resume .local/vector-refresh-test.json --retry-failed
```

`TEST_API_ORIGIN` and user `123` are placeholders; do not run them against an unverified installation. Optional `--kind article|collection|user-article|user-collection` and `--from-user/--to-user` select a limited scope. Default scope includes subscriber-only and no-history users. Four ordered stages run articles, Collections, user article preference, user Collection preference. An unresolved page blocks later stages; exit 2 means incomplete, 130 means interrupted, and 1 means configuration/runtime failure. Only confirmed selected-scope completion exits 0. No command switches reads.

State holds only a page of at most 50 targets, cursors, scope fingerprints and counts. Results use `.results.ndjson`, current failed targets use `.failed.json`; files use mode 0600. The checkpoint's committed journal byte boundary lets resume discard an uncommitted append before replay/counting. Reusing a new state path with existing sidecars is rejected. Replay uses the real shared idempotent writer/checkpoint, not a new ledger or coordinator. Dry-run performs only read-only enumeration and stdout counts: no API/provider/index/database writes or state/result/failed-file changes.

## Executed checks on this integrated tree

- `pnpm install --frozen-lockfile --ignore-scripts --offline`: succeeded, lockfile unchanged, no dependency added.
- `SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=postgresql://unused@127.0.0.1:1/unused LOGS_DATABASE_URL=postgresql://unused@127.0.0.1:1/unused pnpm api -- gen:all`: passed; the first interrupted generation was rerun to completion.
- `pnpm api -- lint`: passed, 0 errors / 347 existing warnings.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- test`: final run 244 files passed / 16 skipped, 3010 tests passed / 130 skipped.
- `SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build`: all Worker dry-run bundles passed, no deployment.
- `SLAX_API_SKIP_DOTENV=1 pnpm api -- test:http`: passed using the existing isolated real HTTP harness.
- `SLAX_API_SKIP_DOTENV=1 pnpm api -- test:vector-refresh:local`: passed on final source.
- `pnpm exec openspec validate --all --strict`: passed (98 items before the final evidence-only update; rerun at handoff).

Local records are in `.local/vector-refresh/`: `local-acceptance.json`, `local-command.log`, redacted `local-worker.log`, `tests.log`, `lint.log`, `typecheck.log`, `build.log` and `http.log`.

## Real local chain evidence

The test uses a newly owned Docker PostgreSQL instance with all 65 historical migrations, an actual SELECT-only enumeration role and separate writer connection, root CLI subprocess, real Edge/Core Workerd HTTP, actual frozen foundation writer/database and local R2 originals. Only Jina and native Vectorize transports are fixtures; fixture controls are confined to the loopback-only existing diagnostic Worker, not production code. No cloud requests, recommendation substitute or Workflow remote success is claimed.

Final counts: 55 articles ready, 1 Collection ready; 2 user-article vectors plus 2 cold starts; 1 user-Collection vector plus 3 cold starts. A subscriber-only user and no-history user are both covered. Two private bookmark IDs share a URL but remain distinct. Article and Collection use default namespaces; user results use `user-article` and `user-collection`.

The first injected native mutation failure returns CLI exit 2; retry resumes and succeeds. The provider fixture saw 10 requests with batch sizes `[8,8,4,8,8,8,8,4,8,7]`, including the replay after failure; native mutations likewise contained multi-article batches. A subsequent complete rerun leaves accumulator weights/sum hashes unchanged. More-than-one-page aggregate progress is persisted in the real `sr_recommendation_work`; a one-step budget returns 2, deleting a saved item before resume removes its contribution rather than resurrecting it, and completion clears that checkpoint. Archive leaves accumulator values unchanged; unsubscribe yields explicit cold start and removes the subscription contribution. Both old `sr_vector_backfill_run` and `sr_vector_backfill_item` remain empty. Dry-run changes none of the fixture counters or local state files. Owned containers and Worker process groups are cleaned by their exact recorded IDs.

Focused unit tests also prove strict allowlists/bounds, Core auth before runtime creation, Edge ordinary API-key rejection, old `/runs` still disabled, output redaction, interruption after acknowledged writes, uncommitted journal-tail recovery, duplicate-count prevention, writable-role rejection, malformed partial-done rejection and nonzero unfinished outcomes.

## Actual remote attempt and remaining blockers

Remote execution is paused pending an operator-explicit approved test configuration path or environment entrypoint. The parent reported only that the main worktree's `deploy/local/api.toml` exists; this does not establish test authorization or identity. Do not inspect, infer from, or copy that file automatically, scan secret files or deployment secret lists, or infer a usable credential. Credentials remain operator-injected through the protected process. Preserve the existing implementation, local evidence and requested remote command; no deployment or ten-article real write has occurred.

The exact requested startup was attempted, not simulated:

```sh
SLAX_API_SKIP_DOTENV=1 \
CLOUDFLARE_ACCOUNT_ID=52bb95cdad45ee5441e67b3a1e9dce5b \
pnpm api -- wrangler core dev --remote --env dev --profile prod --ip 127.0.0.1 --port 8798
```

It exited 1 at `apps/api/script/deploy/config.ts:95` with:

```text
API configuration is missing. Prepare api.toml using deploy/cloudflare/api.toml.example.
```

This worktree has only the public example, no `deploy/local/api.toml`; `SLAX_API_CONFIG` and `SLAX_API_ENV` were unset. No remote startup or writes occurred. The process also had no `VECTOR_REFRESH_DATABASE_URL`, `VECTOR_BACKFILL_TOKEN` or `JINA_API_KEY` injected; values were never printed. Existing auth profile storage was not read or copied. There are **zero remote article results, zero remote fixture IDs and no real Jina/Vectorize/PG/Workflow evidence** to hand to recommendation testing yet.

Minimum non-sensitive configuration needed to resume safely is the selected test configuration path; its exact dev Worker/service and existing Workflow bindings; test API HTTPS origin; account `52bb95cdad45ee5441e67b3a1e9dce5b`; the three exact test index bindings/names, capacity and frozen recipe/digest; and explicit test PG host/database identity matching Hyperdrive. Credentials must be injected through authorized process/native secret handling, not sent in chat or copied from another worktree. Do not create a fake operator config from guessed resource IDs.

Observed wrapper constraints: `checkRemote()` requires real HTTPS API origin, non-placeholder binding IDs, frozen recipe/shards, existing maintenance Workflow bindings and `RUN_ENV=prod`. That is the wrapper's runtime safety mode, not permission to target the production account; `--env dev` selects the configuration section. The wrapper was not weakened or bypassed. Installed Wrangler 4.127.1 `dev --help` confirms `--remote` executes on Cloudflare with remote resources, not a local fixture. Its `vectorize create-metadata-index --help` currently lists string/number/boolean, contrary to the earlier assumption that boolean was absent; no metadata index command was executed and actual account support is unverified.

Still required: safe actual test configuration, real ten-article batch and budget evidence, live business mutations and Workflow state, and real index readback/query and cleanup. The recommendation GET routes are now integrated as recorded below, but no real-cloud acceptance has occurred. Large-PDF 50 MiB supplier acceptance remains separate. Deep-reading research/implementation has not started.

## Review and handoff

Bugs pass: checked target correlation, non-ready transport semantics, cold-start handling, shared-checkpoint replay, page commit boundary and sidecar reuse; added regressions for concrete failures. Security pass: machine-only Edge/Core auth, pre-runtime validation, ID-only SQL/output, environment-only credentials, no ordinary API-key bypass, no new production fixture endpoints, no secret-file reads, no remote mutation. Compliance pass: no new switch/schema/queue/coordinator, frozen algorithms untouched, native batch use verified; remote scenarios remain explicitly incomplete rather than checked off.

No application version was changed. The integrated recommendation slice adds shared contract types; the parent owns the affected-application version decision already identified in the recommendation proposal. No UI or hands-on UI acceptance is implicated. The post-merge archive task remains pending and no PR is opened.

## Same-version recommendation integration — 2026-11-04

The parent explicitly authorized integrating only the recommendation handoff into this worktree. Its manifest `/Users/daguang/project/slax-reader-vector-recommendation/openspec/changes/vector-content-recommendation/handoff.json` has SHA256 `bea93210585e21510cc9727e27f52fe57f1a8abe927b7693f21ae05e8a61e4f0`. All 23 source file hashes were verified before import. All targets were absent or exactly matched the manifest's `before` hash: there were no content conflicts with synchronization edits.

New files were written exactly; existing files received only manifest hunks through read-before-edit. `script/gen-routers.ts` received its controller-list source entry; `dependency.ts` and `readerRouter.ts` were produced by `pnpm api -- gen:all`, not copied or hand-patched. The contracts package has no barrel generator (its only script is typecheck); its handwritten `src/index.ts` received only the one reviewed additive export. Final verification reports **23/23 hashes exactly match the recommendation handoff**, including both generated outputs. The existing sync API/CLI, Edge/Core machine admission and local sync harness remain intact.

Files imported or merged in this integration:

- `apps/api/script/gen-routers.ts`
- `apps/api/src/di/generated/dependency.ts`
- `apps/api/src/di/generated/readerRouter.ts`
- `apps/api/src/domain/contentRecommendation.ts`
- `apps/api/src/domain/pgRecommendation.ts`
- `apps/api/src/domain/recommendationAdmission.ts`
- `apps/api/src/domain/recommendationSelection.ts`
- `apps/api/src/domain/recommendationSession.ts`
- `apps/api/src/handler/http/contentRecommendationController.ts`
- `apps/api/src/handler/http/contentRecommendationHandler.ts`
- `apps/api/test/domain/contentRecommendationService.test.ts`
- `apps/api/test/domain/recommendationSelection.test.ts`
- `apps/api/test/helpers/recommendationAssertions.ts`
- `apps/api/test/helpers/recommendationCorpus.ts`
- `apps/api/test/infra/collectionReadPagination.integration.test.ts`
- `apps/api/test/runtime/contentRecommendationRemote.ts`
- `apps/api/test/runtime/contentRecommendationSmoke.ts`
- `apps/api/test/runtime/contentRecommendationWorker.ts`
- `apps/api/test/runtime/recommendationAdmissionCases.ts`
- `apps/api/test/script/contentRecommendationRemote.test.ts`
- `apps/api/test/script/generatorPaths.test.ts`
- `packages/contracts/src/content-recommendation.ts`
- `packages/contracts/src/index.ts`

This validation record is the only additional file modified for integration evidence. No recommendation planning files or unrelated source were copied. The recommendation proposal was read in its original tree, including its explicit human apply approval and capability ownership.

The frozen manifest comparison now has twelve expected differences: five previous sync consumer/test changes, plus the recommendation controller-list, two generated outputs, two domain consumers, generator test and contract barrel. All other frozen source files still match, including both independent write Workflows, legacy search reads, three-index/two-user-namespace routing and whole-input estimation/bisection. No schema, runtime toggle, service or dependency was introduced.

### Non-service verification executed

The standard generator ran with the same public template and `SLAX_API_SKIP_DOTENV=1` as above and completed successfully. Then:

```sh
pnpm api -- typecheck
env -u SOURCE_INGESTION_TEST_DATABASE_URL -u RECOMMENDATION_TEST_DATABASE_URL -u FORK_TEST_DATABASE_URL \
  RUN_PG_INTEGRATION_TESTS=0 RUN_COLLECTION_READ_SQL=0 PAYMENT_LOCAL_PG_TEST=0 ACCOUNT_LOCAL_PG_TEST=0 \
  SLAX_API_SKIP_DOTENV=1 pnpm api -- test
SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build
pnpm api -- lint
git diff --check
pnpm exec openspec validate --all --strict
```

Results: typecheck passed; **247 test files passed / 16 skipped, 3021 tests passed / 130 skipped**; all offline Worker dry-run builds passed; lint 0 errors / 347 existing warnings; whitespace and strict OpenSpec validation passed. Logs are `.local/vector-refresh/integration-{gen,typecheck,tests,build,lint,openspec}.log`. The real-database opt-ins were explicitly disabled rather than silently inherited. No dev process, runtime smoke, remote verifier, HTTP live test or service was started; no machine-level dev singleton was acquired or bypassed. No operation targeted the occupied `127.0.0.1:8686` listener or PIDs 71000/70856, and no ports or global settings were changed.

### Next same-version real ten-article acceptance entrypoints

The latest parent instruction names `pnpm api -- dev` as the startup entrypoint. It was deliberately **not run** because another worktree owns the machine dev session; the parent will assign the subsequent live-write owner and arrange the approved environment without killing unrelated processes or bypassing the lock.

The integrated production surfaces are:

- Bulk: `apps/api/src/handler/http/vectorRefreshHandler.ts`, `apps/api/src/infra/vectorRefreshRuntime.ts`, `POST /internal/v1/vector-backfill/entities`, and `apps/api/script/vector-refresh.ts` through `pnpm api -- vector:refresh`.
- Recommendations: `apps/api/src/handler/http/contentRecommendationController.ts`, generated real routes `GET /v1/recommendations/articles` and `GET /v1/recommendations/collections`; optional `preference_kind=article|collection` selects one independent profile.
- Ten synthetic bodies/member mappings: `apps/api/test/helpers/recommendationCorpus.ts`.
- Lifecycle scenarios and independent-state assertions: `apps/api/test/runtime/contentRecommendationSmoke.ts`, `apps/api/test/runtime/recommendationAdmissionCases.ts`, `apps/api/test/helpers/recommendationAssertions.ts`.
- `apps/api/test/runtime/contentRecommendationRemote.ts` accepts `--remote --prepare --manifest <verified-public-json>` but **only prepares a manifest/corpus**; it is not a live ten-article test executor. `contentRecommendationWorker.ts` and `contentRecommendationSmoke.ts` use explicit model/index fixtures and must not be deployed or labeled as real-cloud acceptance.

Therefore the source surfaces are integrated and standard-checkable in one version; a complete real-cloud lifecycle execution is still pending with the designated owner using real protected business/test ingress and these actual routes. No remote fixture IDs or new provider/Vectorize/PG/Workflow evidence exist from this integration pass. The earlier local results remain earlier local evidence, not proof of this version's live or cloud behavior.

## PDF policy cross-reference — 2026-11-04

The shared `VectorMaintenanceService` used by the bulk refresh follows the human-approved size policy instead of PDF page splitting: an original at most `8_000_000` bytes is sent unchanged once as one PDF input; a larger accepted PDF, up to the unchanged 50 MiB source-upload limit, uses already extracted text without reading the original body. This supersedes the historical requirement for direct 50 MiB supplier acceptance: large originals are no longer submitted to the PDF provider. The original policy test pass did not itself run bulk/cloud scenarios and is not relabelled as doing so. Its routing/boundary/failure/local Workerd evidence and subsequent actual Jina/test-index and lane-B CLI runs are separately recorded in `../vector-v5-recommendation/validation.md`; real versus local-only qualifications are preserved. A HEAD-only 50 MiB test proves no large-original download on embedding, not a new direct-upload provider capability.
