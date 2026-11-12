# Validation

## Scope and approval

The user explicitly approved one unified repair after reviewing the production audit and requested deletion of the other worktrees followed by a new implementation worktree. Eight additional worktrees were removed after preserving their uncommitted OpenSpec files and ignored local state under `.local/worktree-backup-20261111/`. The main worktree's existing changes and all branch references were retained. The repair worktree is `.local/vector-incremental-repair`, branch `fix/vector-incremental-repair`, based on `origin/dev` at `d93adef2`. The initial implementation was kept local. The user subsequently explicitly requested PR delivery, authorizing commit, push and creation of a task PR targeting dev. Deployment and production mutations remain outside this delivery step.

## Automated checks

Final validation on 2026-11-11:

- `pnpm api -- gen:all`: passed; required DI/router/model/runtime generation was used rather than hand-editing generated artifacts. No tracked generated output changed.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- test --maxWorkers=2`: **249 files passed, 15 skipped; 3,942 tests passed, 142 skipped; zero failures**. Skips retain the repository's existing opt-in environment/integration conditions. No test was disabled to make the change pass.
- `pnpm api -- lint`: passed with zero errors and 343 warnings.
- `pnpm api -- build`: all four Worker targets completed Wrangler `--dry-run`; nothing was deployed.
- Changed TypeScript files were formatted with the existing Prettier configuration; `git diff --check` passed.

Generation/build used the public `deploy/cloudflare/api.toml.example`, `SLAX_API_SKIP_DOTENV=1`, `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, `WRANGLER_SEND_METRICS=false`, and loopback placeholder database URLs for generation only. Tests ran with the generator-only config override and database URL overrides removed. Secret files were not read or copied.

## Running environment

In addition to tests, a standalone local HTTP smoke bundled this branch's real `VectorPreferenceObject`, `SqlPreferenceStore`, `VectorMaintenanceService`, queue and RPC client with installed esbuild/Miniflare, ran actual Workerd HTTP calls with real SQLite, and disposed the runtime afterward. PostgreSQL and Vectorize boundaries were deterministic fixtures; this was not a production run. Final post-bootstrap-change smoke passed:

1. Seed legacy v2 tables and an owner with one available and one missing member. First apply migrated once to v3 and published user and Collection partial coverage.
2. Make the missing vector available, then replace another vector without supplying an old remote value. Both applied without increasing the history/bootstrap counter.
3. Repeat apply; user vector stayed identical with no duplicate weight.
4. Toggle owner sharing and publish; article/row/history read counters stayed unchanged.
5. Remove the last valid contribution while an eligible missing member remains; both user and Collection projections cleared.

Observed output: `finalHttpSmoke=passed`, `v2Migration=true`, `partialCollectionPublished=true`, `repairAndReplacementNoRebuild=true`, `repeatedApplyIdempotent=true`, `publicationNoHistoryRead=true`, `zeroUsableCleared=true`, `bootstrapReads=1`, `productionWrites=0`.

The existing real Edge/Core Workerd fixed-key route test also passes with the changed repair-admission behavior; controller-entry authentication, target/body boundaries and native result semantics remain covered. Workflow tests assert accepted receipts do not re-embed, preference visibility retries do not re-apply contributions, failed individual projections retry independently, and no subscriber fan-out occurs.

## Audit-to-acceptance mapping

- Partial Collections publish valid sums and numeric coverage; missing members become applied contributions when repaired. Legacy strict-missing assertions were replaced, not bypassed.
- Missing original HTML does not block available text. Missing Markdown can use text extracted from stored HTML; scripts/styles are removed and no source URL is fetched. Restored image availability changes the source fingerprint.
- Only explicit image decode/aspect/size messages at 400/413/422 become image skips. Other provider/auth/network failures remain failures. Deterministically rejected text is isolated from successful batch siblings.
- Relation-only star/share/delete events bypass source processing, even when the source status is not ready; mixed dispatch deduplication keeps a content event when one exists.
- Saved actual contributions allow exact subtraction without remote old-vector lookup or full-history fallback. Malformed individual source vectors do not poison valid peers.
- Zero usable owner contributions clear stale materialized projections; deleted accounts cannot republish cached profiles.
- Collection publication uses an indexed local timestamp lookup, not a full-owner SQL MAX scan. Real SQLite execution-plan checks confirm index use and no SCAN.
- Recent actions update and expire locally within the existing 90-day/2,000-action window. Tests verify new saves/deletion/expiry without ordinary history/recent-action SQL scans.
- Accepted deletion/shrink records deterministic removed IDs and defers visibility; no subsecond acceptance failure gate remains.
- v1/v2 layout bootstrap and rollback/re-upgrade detection are covered by real SQLite runtime tests. Bootstrap stores at most 100 entries per page and exposes no state row until completion. A 301-entry interruption test verifies partial initialization is not usable, no projection is published early, and retry completes without duplicate entries.

## Operational boundaries

- Existing production business data, original R2 objects and native article vectors do not need deletion. The first maintenance of each legacy owner performs a one-time bounded bootstrap into local v3 state; later updates are incremental.
- The saved production inventory contains an owner with 12,394 eligible articles, so bootstrap was changed from retaining all contribution arrays to pagewise persistence. A full-scale production upgrade was not executed; real runtime migration and multi-page/interruption regressions were executed locally.
- Interest action storage is updated incrementally, but the existing clustering algorithm is recomputed over the bounded recent-action window. This is not constant-time clustering and is not a full-history rescan.
- Individual live PostgreSQL/Vectorize/provider failures were not injected in production. Fixture-driven provider replies use the previously observed failure shapes. This run did not re-run production sync or claim the remaining production failures are already repaired.
- Optional full local PostgreSQL/Redis setup smoke was not run; actual Workerd/SQLite/HTTP paths and PGlite-backed integration tests cover the changed surface.
- No UI presentation, client package, shared client contract or runtime dependency changes are included; client version increments and visual acceptance are not applicable.

## Local review

Bugs, Security and Compliance passes were performed against the final diff and this change's requirements. Full-history fallback, stale-zero publication, strict Collection gates, relation/source coupling, event deduplication and partial-initialization visibility were checked explicitly. Identity/authentication errors and actual service failures remain errors. There are no new dependencies, endpoints, credentials or production access configuration. Source content and provider credentials are not included in the change.

`pnpm exec openspec validate --all --strict` passed: 135 items, zero failures. Final diff inspection found no new generated-output, dependency, client, or production configuration changes. The four generated dry-run bundle directories were removed after verification; the local HTTP runtimes were disposed. The only registered worktrees are the untouched main worktree and `fix/vector-incremental-repair`; preserved local-state/proposal backups remain under `.local/worktree-backup-20261111/`. No Important findings remain in the local Bugs/Security/Compliance review; the explicitly stated production and full-scale upgrade gaps remain for release acceptance.

## D1 state revision (2026-11-12)

After merge and test deployment the user rejected persistent contribution vectors in Durable Object storage and directed persistent state to D1 with the Durable Object limited to concurrency control. The revision was made on branch `fix/vector-preference-d1-state` from `origin/dev` at `69c56d58`.

Automated checks on the revision:

- `pnpm api -- gen:all`: passed. `pnpm api -- typecheck`: passed.
- `pnpm api -- test --maxWorkers=2`: **249 files passed, 15 skipped; 3,947 tests passed, 142 skipped; zero failures**.
- `pnpm api -- lint`: zero errors, 343 warnings (unchanged count).
- `pnpm api -- build`: all four Worker dry-runs completed; nothing was deployed. Generated bundle directories were removed.
- D1 migration 00066 was applied to a scratch SQLite built from every existing D1 migration; `gen:diff:d1` against it reported no remaining difference for the two new tables. The Prisma-generated diff also rebuilt the unrelated `slax_bookmark_share` table, so the migration was reduced to the two `CREATE TABLE` statements and one index.

Running environment: `test/utils/vectorPreferenceObject.runtime.test.ts` runs the real `VectorPreferenceObject`, `D1PreferenceStore`, `VectorMaintenanceService`, queue and RPC client in Workerd through Miniflare with a real D1 database migrated by 00066 and real Durable Object SQLite storage. PostgreSQL and Vectorize are fixtures. It verifies:

1. State lives in D1; the Durable Object's own SQLite has no preference tables and stays under 16 KiB after every operation.
2. Concurrent applies for one user are combined into fewer batches; star, delete with handed-over vector, and owner share/status toggles stay incremental and match a full rebuild within 1e-10.
3. The Collection publication-time query uses `slax_vector_preference_entry_user_id_share_group_published_at_idx`.
4. Deleting every member removes the D1 state and entries.
5. Durable Object v2 and v3 state is moved into D1 with identical entries and counts and no article-history or article-vector read, then the object storage is erased. The unusable v1 layout rebuilds once. Stale object tables beside existing D1 state are erased without a rebuild.
6. Replacing a vector with the old vector handed over does not rebuild.

Domain tests additionally cover: a replaced vector without its old value rebuilds once instead of subtracting a guess; stored entries contain only weight, group, token and publication time; ordinary events carry clusters and do not read the recent-action window or history; explicit refresh reclusters from the bounded window; the repair route and relation deletion hand the replaced vector to the Workflow.

Gaps: no remote D1 migration or deployment was run. Production object state migration was exercised only locally. D1 throughput under bulk sync on the shared `DB` binding was not load-tested.
