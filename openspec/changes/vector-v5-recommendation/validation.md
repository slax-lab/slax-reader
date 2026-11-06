# Validation

## Scoped configuration sync and fulltext plan audit — 2026-11-06

The human selected only follow-ups 1 and 2: synchronize the private configuration's request-cancellation flag and investigate the historical index-sensitive fulltext query. Other open work is neither implemented nor waived.

Configuration: fetched the sibling repository's origin and confirmed HEAD equals origin/main at 70d0057 with zero divergence. Edited exactly one compatibility_flags line in each of api/dev.toml, api/beta.toml, api/prod.toml and the retained api/main.toml copy, adding enable_request_signal. Dates remain 2025-05-05 for dev/beta and 2024-08-06 for prod/main. No credential values, bindings, variables or compatibility dates changed, and no deployment, commit or push occurred. The ordinary workerConfig/writeGenerated path preserves these flags on Edge/Core; two new public-fixture tests cover both dates and local/deployment generation. The config diff contains only these four flag-line replacements.

Historical fulltext protection: SearchService.fulltextSearch still partitions raw row IDs into groups of 50 before BookmarkSearchRepo.seachBM25. Its warning and WITH filtered_ids / DISTINCT / rowid JOIN / MATCH SQL trace to the original backend import 10c5271e and are unchanged from HEAD. Added a 125-candidate regression requiring 50/50/25 calls with all IDs preserved. The fulltext-engine adapter now expands Prisma.sql including Prisma.join and captures the actual Repository-generated SQL; EXPLAIN no longer tests a separately copied SQL string.

Real local D1 observations on 2,000 synthetic rows:

| Query | Returned | D1 rows_read | Access path |
| --- | ---: | ---: | --- |
| Existing 50-ID CTE, common term matching all rows | 50 | 202000 | CO-ROUTINE filtered_ids; SEARCH r USING INTEGER PRIMARY KEY; FTS INDEX 0:M2; SCAN f |
| New candidate query, rare term matching 50 rows | 50 | 150 | FTS INDEX 0:M2; SEARCH raw USING INTEGER PRIMARY KEY; temporary ORDER BY B-tree |
| New candidate query, common term, LIMIT 100 OFFSET 0 | 100 | 6000 | Same indexed access and temporary sort |
| New candidate query, common term, LIMIT 100 OFFSET 900 | 100 | 6000 | Same indexed access and temporary sort |

Both actual queries use the FTS MATCH index and raw-row primary-key lookups; neither plan contains a full raw-table scan. SCAN slax_fts_bookmark VIRTUAL TABLE INDEX 0:M2 is the indexed MATCH iterator, not evidence of a missing FTS index. However, indexed retrieval is not a bounded-work guarantee. The legacy CTE also exhibits substantial repeated work for common terms in this fixture. The new query ranks the global matching set before limiting returned candidates, and OFFSET pages repeat that work. The 100-result/1,000-candidate application limits do not cap database rows_read at 100/1,000. These local row counters are not production timings or counts of distinct articles. Production index health, workload scale and latency remain unmeasured; no SQL/ranking/permission changes were made in this audit.

Verification: standard public-template gen:all, typecheck, lint --quiet and all four Worker dry-run builds passed. The final focused run passed 77/77 tests across deployPaths (16), actual hybridSearch.runtime (3), fulltextEngine.integration (14), searchHighlightSecurity (10), and unifiedSearch.repository (34). The real runtime demonstrated an early TCP partial before the delayed embedding, one complete event, independent channel failure and one cleanup after socket cancellation. The standard full API suite with SLAX_API_SKIP_DOTENV=1 and no SLAX_API_CONFIG override exited 0: 236 files passed, 15 existing files skipped, 3,585 tests passed, 117 existing tests skipped and zero failures (58.14 seconds). The initial whole-suite command inherited this audit's public-template SLAX_API_CONFIG; nine isolated setupBackend fixtures failed because that relative path did not exist in their temporary repositories. The fixture inherits process.env, so removing only the audit's command-level override fixed the invocation; no setup production/test code was altered. Build outputs were placed in a unique temporary directory and removed.

Retained verification failures: the first new seed used multiline D1 exec and failed during fixture setup; it was corrected to prepared-statement run without changing production. A temporary attempt to pass Wrangler's nodejs_compat_v2 directly to the existing esbuild/Miniflare fixture failed with missing node:os, including its previous baseline date. That unsupported harness experiment was reverted, not counted as a pass. The established runtime fixture remains unchanged at compatibility date 2026-08-01 with its supported Node flag. Therefore the private dates have generated-config coverage, not an end-to-end private-configuration runtime claim. Standard Wrangler public-template bundling with nodejs_compat_v2 passed.

Scoped review: Bugs — preserve the original SQL and 50-ID grouping, and distinguish bounded returned candidates from total matching/ranking work. Security — synthetic local data only, no new dependencies, no production data calls, no private credential output. Compliance — the explicit follow-up authorizes only the flag edit and audit; all wider release gates remain open. This changes API configuration/tests/evidence only, with no CLI/Extension/Mobile shipped logic or package change requiring a version increment.

## Latest revision pending — keyword-only hybrid search, 2026-11-06

The latest explicit correction removes the public limit/default20 from POST /v1/search: the body is only `{keyword}` and complete returns all fused finally admitted candidates, without final slicing or result_limit_reached. Internal per-channel100 and fulltext scan budgets remain with honest incomplete/truncation coverage; this does not authorize an unbounded database scan or change the old bookmark endpoint.

The correction is implemented and verified on current source. The request parser returns only keyword and rejects limit as an unsupported field; complete has neither a final slice nor result_limit_reached. A test combines70 title and70 vector matches with30 overlaps and confirms all110 distinct fused results are returned. DeepSeek ran six focused files with151/151 passing, including real Workerd early partial, unique complete and disconnect cleanup, then the full API suite:235 files passed/15 existing files skipped,3,568 tests passed/117 existing tests skipped,zero failed. Logs: .local/task-auth-verification/no-limit-focused.log and no-limit-full.log. Public-template gen:all, typecheck, lint --quiet and scoped diff checks also passed. Old BookmarkSearch and internal recall/scan-budget tests remain unchanged.

The user-requested fulltext-engine examination added test/infra/fulltextEngine.integration.test.ts and passed13/13. It executes production Normalizer with the actual SlaxJieba WASM (Durable Object transport adapted locally), real Miniflare D1/committed FTS5 porter-unicode61 schema and Repository SQL, plus migrated PGlite current-save admission. It verifies Chinese body-only phrases, mixed CJK/ASCII, English stemming/case, quotes/hyphens/underscores/symbols, title/body matches, update/delete index triggers, multi-chunk dedup, pagination and stale-candidate exclusion. These13 tests are separate from the preceding3,568-test full snapshot, not an inflated full-suite total. No production source change was required by the examination.

Boundaries remain explicit: snippets come from normalized indexed body text, not a guaranteed verbatim raw-body quotation; Rare_Phrase matches its normalized rare phrase but rarephrase does not promise separator-insensitive compound recall. The fulltext service still caps recall at100 admitted candidates and scans at most10 pages of100 candidates; it reports candidate_limit/scan_budget rather than claiming exhaustive results. EXPLAIN confirms FTS virtual-index MATCH plus rowid lookup and a temporary sort B-tree, not production-scale latency evidence. No production database/index health, data completeness or load testing was performed. No private resources/configuration were accessed; older logs retain their original snapshot qualifications.

## Current revision pending — article-marker and auth corrections, 2026-11-06

This section supersedes older active guidance and acceptance wording below. All existing test logs, counts, research measurements, resource observations and earlier acceptance matrices are preserved as historical evidence of their recorded snapshots. In particular, public-Collection-member article admission, article/chunk `recommendable` assertions, active four-channel article ranking and Authorization-Bearer Edge/Core task gates are not the current contract. No earlier green count proves the latest corrections.

Current marker boundary: remove `recommendable` from article representative/chunk writes and stop deriving article-feed admission from Collection membership. Preserve Collection `recommendable` visibility, aggregate processing and recommendation filtering. An existing article metadata index may physically remain but is unused; no production cleanup, configuration change or cloud operation is authorized. Until an operator-supplied public article pool exists under a separately established contract, the article feed returns `no_public_candidates` without ANN, latest/popular queries, candidate hydration or model calls. No new pool endpoint or script is included. Article retrieval/ranking research and calibration below remain paused historical design; maintained raw/centered user preferences and Collection recommendation are not cancelled by that pause.

Refresh authentication is owned by `../vector-bulk-sync/`: existing whitelist entries and unchanged middleware feed Controller-first X-Vector-Refresh-Secret checks, with VECTOR_REFRESH_SECRET only in Core and the caller. Edge has no task gate or task mode. The marker change does not duplicate that capability's delta.

Search authorization changed after that static inspection: the human explicitly requested one new authenticated streaming hybrid `/v1/search`, rejected separate endpoints, and added Collection/article/RSS title coverage. The current proposal, design and vector-v5-runtime delta define that implementation. The existing bookmark natural-query path remains jina-clip-v2 with legacy buckets; no old-route query/index cutover or production deployment is authorized. Unified-search implementation and its running-environment acceptance are still pending; native-query availability alone is not acceptance.

### Current scoped execution evidence

- Custom-header authentication: DeepSeek ran nine files / 242 tests, all passing with no skips. This includes actual local Miniflare/Workerd Edge/Core requests through generated routing and real SHA-256/timingSafeEqual. Repositories, sources, model and native index were isolated fixture boundaries, not cloud resources. Log: `.local/task-auth-verification/focused-x-vector-refresh.log`.
- Marker correction: the updated focused run recorded 345 passing and 3 failing tests across 17 files. Passing coverage includes article/chunk marker omission, stale-marker replacement, native owner filters, paused article feed with zero dependency calls, Collection behavior and response/event wrappers. Log: `.local/task-auth-verification/marker-focused.log`. The three failures exposed monitor rebinding cleanup and cached re-save admission gaps; they were not waived.
- Monitor correction: after the minimal monitor source fix, DeepSeek ran `pnpm api -- test test/domain/vectorMaintenanceHooks.test.ts test/flow/addUrl/4-workflowDispatch.test.ts test/flow/addUrl/8-postProcessing.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts test/infra/vectorMaintenanceRebinding.test.ts`: five files / 162 tests passed, zero failed or skipped. This verifies old-identity cleanup even after admission rejection, successful cached content using skipParse, no premature pending-content maintenance, real CrawlService admission gates and existing cached Workflow post-processing. Log: `.local/task-auth-verification/monitor-fix-focused.log`. It is local fixture/composed evidence, not a new cloud run.

### Unified-search intermediate verification (not final acceptance)

- Contract/Service/Orchestrator/Controller tests: four files / 103 tests passed, zero failed or skipped (`hybridSearchContract` 42, `domain/hybridSearch` 30, `domain/orchestrator/hybridSearch` 15, `hybridSearchController` 16). Log: `.local/task-auth-verification/hybrid-search-service.log`. These exercise parser boundaries, four concurrent channels, one shared query embedding, early text callbacks, exact RRF arithmetic, typed dedup, final revalidation, pagination/truncation and Controller stream cancellation/cleanup. Direct Controller streams and fixture dependencies do not prove the generated Edge/Core route works.
- Repository tests: `pnpm api -- test test/infra/unifiedSearch.repository.test.ts` has 26 passing tests on the recorded intermediate source. The fixture applies all 56 committed PostgreSQL migrations in isolated PGlite and both fulltext migrations to real local Miniflare D1. It executes title/alias/literal-wildcard matching, Collection and RSS subscription visibility, typed relation IDs, current admission, BM25 ordering, bounded pages and FTS triggers. It is not a Docker PostgreSQL or cloud run.
- The additional real-SQL stale-private tests produced 26 passes / 5 failures in the same repository file. They reproduce one missing own-origin predicate: a nondeleted viewer relation to another user's private snapshot returns title/URL and a false own origin. A separately valid followed-Collection origin must remain readable while the false own origin is removed. These failures are not waived.
- Focused Bugs/Compliance review also requires Collection origin serialization to expose the encoded owner-relation cb_id and owner bookmark UUID used by the current reader, title-channel origin/match revalidation rather than retaining score after its matching alias disappears, and Collection-vector admission to drop stale aggregates after their last eligible public member is removed (empty Collection title discovery remains separate). Generated /v1/search registration and actual Edge-to-Core early HTTP chunks are not yet accepted. The source owner is completing generation/static checks and the parent will route concrete fixes back before final acceptance. No new search task is marked complete from intermediate green counts.

### Corrected-source acceptance checkpoint

The preceding intermediate failures were retained and fixed, not waived. The final source owner ran public-template gen:all, typecheck and lint --quiet successfully; the independent narrow reviewer closed all four reported source findings. Current SQL verification is 34/34 passing in `test/infra/unifiedSearch.repository.test.ts`, including the five previously failing private-origin cases, bounded candidate-keyword rechecks after alias removal/rename, and collection-vector-only current-member admission without suppressing empty Collection title discovery.

The current Service/Orchestrator/Controller plus real-runtime set reports 106/106 passing across five files. `test/utils/hybridSearch.runtime.test.ts` runs actual Edge → Core → generated /v1/search → auth → Controller → Orchestrator → Service in local Workerd. Repositories, model/index and tokenizer are explicit test fixtures; PostgreSQL-compatible/D1 SQL behavior is independently covered above. In the measured run firstPartialAt=1793940260498, gateReleasedAt=1793940260511, completedAt=1793940260519 and cleanupAt=1793940260520: a real TCP body reader received a partial before releasing the delayed embedding. Exactly one query embedding and one complete event occurred, all four entity types appeared, and cleanup ran once. A fulltext failure produced channel_error while successful branches and final completion remained available.

Real client socket disconnect now passes with requestAborts=1, vectorArticleCalls=0 and cleanupCount=1. It requires enable_request_signal in BOTH Edge and Core compatibility flags; removing either made the test fail. The public api.toml.example includes the flag without changing the compatibility date. Existing private/production configurations were not read, changed or deployed and must be synchronized by the operator before relying on disconnect cancellation. The Miniflare test uses its supported direct TCP socket path because its ready-proxy response cancellation did not propagate disconnects; this is a test harness detail, not a production endpoint or workaround. Logs: `.local/task-auth-verification/hybrid-search-current.log` and `hybrid-search-runtime.log`.

Final navigation and revalidateAll supplementation passed 112/112 across the same five files (Service35, Orchestrator15, Controller17, Contract42, Runtime3). Both real partial and complete results contain encoded numeric Collection cb_id that decodes to owner relation88, preserve owner bookmark_uuid, and do not mutate/re-encode the internal event. Added Service tests cover alias loss/rename, Collection-vector member withdrawal with independent title discovery and type-specific admission failure. A separate three-test supplement makes Orchestrator18/18: shared query-embedding failure marks both vector channels without executing them, all-channel failure still produces one explicit incomplete final event, and all-empty channels remain empty successes. Logs: hybrid-search-current.log and hybrid-search-orchestrator.log under the verification directory.

Independent final static/build gates passed: pnpm api -- typecheck; pnpm api -- lint (0 errors, 344 warnings); openspec validate --all --strict (92 passed, 0 failed); git diff --check; and pnpm api -- build --config deploy/cloudflare/api.toml.example. Actual target names are core, edge, ai and browser, all built as local Wrangler bundles without deployment. The effective public configs retain enable_request_signal. Dotenv loading was disabled, only the public template and placeholder loopback values were used. Logs: final-typecheck.log, final-lint.log and final-build.log. New contract declarations are additive and their runtime consumers are API-only; no CLI/Extension/Mobile logic or runtime imports changed, and no versions were incremented.

Final whole-API run after all current source and the three Orchestrator additions: `pnpm api -- test` exited 0 with 235 files passed, 15 files skipped, 3,566 tests passed, 117 skipped and zero failed (250 files / 3,683 tests total). It includes SQL34, generatorPaths19, Orchestrator18 and runtime3. Log: `.local/task-auth-verification/full-hybrid-search-final.log`. Skips are existing environment-gated PostgreSQL/DB/import-sample suites; no new skips were introduced.

The initial separate stability check was pass/fail/pass, with requestAborts=0 observed after cleanup in the failing run; all original logs remain. DeepSeek identified a test-only observation race: request_abort and embedding_abort were independent fire-and-forget audit fetches, while cleanup was awaited and the assertion waited only for cleanup's arrival. The corrected fixture tracks pending audit promises and flushes them before reporting cleanup, correlates every event to a unique test-request ID, ignores late events from another request and waits for the complete expected predicate with a bounded timeout. Original strict assertions remain requestAborts=1, vectors=0, cleanupCount=1; production cancellation code was not changed for this repair.

Eight sequential real Workerd runtime runs then each passed3/3 without retries or skips, with one shared embedding, one cleanup and a partial arriving before the delayed gate was released. Logs: `.local/task-auth-verification/runtime-verify-1.log` through `runtime-verify-8.log`. The cancellation stability gap is closed by causal harness repair and repeated transport proof, not by hiding the failed run.

The accepted complete rerun after that test-only fixture change exited0: 235 files and 3,566 tests passed, zero failed, 15 files/117 existing tests skipped. Log: `.local/task-auth-verification/full-hybrid-search-accepted.log`. Strict OpenSpec again passed92/0 and git diff --check was clean. No test, source, generator or configuration changed in that final verification pass. This completes the requested unified-search implementation and local acceptance, not production deployment or real-provider relevance validation.

These are separately scoped runs, not additive full-suite totals. Production/provider search quality, broad Security review and production replay remain excluded or deferred as previously directed.

## Historical parent acceptance checkpoint — 2026-11-04

This checkpoint takes precedence over older completion wording below. Detailed historical runs are retained, not silently relabelled as final-snapshot acceptance. The original 27-row acceptance matrix remains the scope.

- **Verified live before the final media patch:** ten-article ingestion, both approved PDF routes, normal re-save, archive neutrality, separate private identities, all three ordinary refresh actions, bounded operator enumeration/continuation, weighted Collection/user profiles, actual article/Collection ranking and save/subscription exclusions. The native read-batch and absent-share fixes subsequently passed real 27-article history, ordered star/repeat/unstar and A/B trash/restore checks.
- **Final media recovery patch and checks:** 93 focused recovery and 314 combined media/Fork local tests pass. The final default API suite reports 216 files passed/15 skipped, 3167 tests passed/118 skipped; typecheck, lint (0 errors/343 warnings), strict OpenSpec (92/0), diff check and isolated four-Worker build pass. Separate real disposable-PostgreSQL Fork integration now passes40/40 and media publication recovery3/3; standard disposable integration passes all10groups. The earlier four Fork failures were stale fixture setup and were corrected only in tests, preserving guarded revision assertions. In-memory R2 and stubbed external generation/admission remain explicitly distinguished from cloud resources. The old failure log is preserved as `repair-media-runtime-superseded-fixture.log`.
- **Corrected PowerSync/Fork/import acceptance completed live:** external-URL PowerSync bookmark112, own-snapshot identity reuse, own-link import association, cross-owner HTML Fork destination115 and import destination116 all have actual content/vector evidence; Workflow112/115/116 subsequently completed the preference steps. Queued Reader compatibility remains the expected stable failed/no-copy path and passed replay/unrelated-mutation checks. Source-owner records were unchanged, 27+eligible history was retained, and no duplicate writer/harness remained at handoff. PDF prior evidence is retained. A subsequent bounded cached-podcast run also passed: bookmark118/relation119 published the cached ready episode body, maintenance completed article and user-preference visibility, native `a:9:118` was1024-dimensional/unit-normalized, and the33-article profile matched recomputation (cosine approximately1). Canonical transcript/article hashes, keys, completion timestamps and statuses remained unchanged; no new transcription/generation was run. See `final-media-live-evidence.json`. The pca.st shortlink produced an ordinary page and is not counted as podcast coverage. No ready cached YouTube row/artifact exists locally, so YouTube live completion remains explicitly not-run/blocked; local and disposable-PG media evidence is not promoted to a live YouTube pass.
- **Recommendation edge cases:** ten new deterministic tests now cover representative-only Collection contribution, expiry/re-activation through real Repository SQL on disposable PGlite, cold start, controlled freshness/MMR, chunk-identity deduplication, Collection member ranking and revocation during hydration. Two files/52 tests pass; seven reused paging/filter tests also pass (subsets are not additional full-suite totals). These are local/disposable-DB evidence, not live Cloudflare coverage; optional native `since` remains unverified beyond correct filter construction.
- **Review/release boundary:** Security audit is explicitly deferred by the user, not an unavailable-model gate for this functional phase. Production deployment, production full-history backfill, coordinated search cutover and post-merge archival have not been performed or claimed. Bot is cancelled and daily-reading UI is deferred.
- **No new source repair in Fast's resumed pass:** the existing patch remains intact; current work is evidence and final regression, with concrete new defects routed to Astra Fast only.

### Consolidated original acceptance rows

`live` means actual normal application requests and authorized test-provider/index evidence. `local` includes controlled application methods, disposable PostgreSQL/PGlite and explicit object/provider stubs. A mixed row does not claim every failure branch occurred in the cloud. Evidence paths refer to `.local/vector-live/` unless stated otherwise.

| ID | Final reviewed status so far | Evidence and qualification |
| --- | --- | --- |
| A01 | passed-live | Ten new Jina article writes and native identity/shape readback; `parallel-A-evidence` retained A01 run. |
| A02 | passed-live + local boundary branches | Real long text/direct PDF/large extracted-text path; exact sizes, complete UTF-8, missing-text/image selection covered locally; no claim of large visual-PDF upload. |
| A03 | passed-live | Existing content re-save reuses identity/source; separate live new-save capture precedes maintenance. |
| A04 | passed-live | `parallel-A-evidence-A04-passed.json`: ordinary external URL PowerSync and mutations; queued Reader compatibility correctly terminal failed/no-copy and replay-safe. |
| A05 | passed-live | `repair-core-evidence.json`: 27-save weighted profile, star/repeat/unstar with native readback and exact aggregate comparison. |
| A06 | passed-live | Archive/unarchive neutral, no archive-only maintenance dispatch. |
| A07 | passed-live + local failure branches | Private trash/restore fixed, permanent own deletion observed; absent-share and error propagation locally covered. |
| A08 | passed-live | A-only removal/restore leaves B representative/profile and shared source unchanged; no business/R2 copies. |
| A09 | partial: media live completion still being finalized | Own/cross-owner Fork/import complete through native vectors and preference Workflows in `parallel-A-targeted-verdicts.json`; PDF live evidence retained. Media failure/recovery has local and real-PG evidence, while external media completion is separately classified in `final-media-live-*`. |
| A10 | passed-live + controlled runtime failures | Actual source-not-ready stays failed without preference; media pre-commit/uncertain-ack/partial-PUT recovery verified on real disposable PostgreSQL with memory object store and stubbed admission. |
| B01 | live success + local edge branches | Exact relation action; pending/failed dependency order and distinct PK covered by190-test group/new3test supplement. |
| B02 | passed-live | Collection-only action and native aggregate match, no article/subscriber recomputation side effects. |
| B03 | live active/missing + local inactive/multiple | Correct subscription-record identity and independent profile; local/PGlite covers expiry/inactive and multi-subscription state. |
| B04 | passed-live bounded fixture | Read-only keyset pages and complete selected user relations in three-stage order; not full production-history execution. |
| B05 | passed-live + structural checks | Scope/IDs/cursor/dry-run and truthful JSON/exit behavior; no checkpoint/receipt platform. |
| B06 | live failed-row continuation + local pending | Later row processed after actual rejection; controlled pending response produces incomplete final result, no invented native race. |
| B07 | actual routing + local/static architecture | Ordinary generated auth routes and DI exercised; no standalone internal refresh bypass, Repository SQL and Controller checks retained. |
| C01 | live aggregate + local multi-part member | Native mean matches eligible members; disposable SQL/index-stub test proves chunks do not multiply one member. |
| C02 | passed-live | Two namespaces/IDs and saved1/starred2 recomputation; PDF page count does not multiply preference weight. |
| C03 | live subscribe/cancel/re-subscribe + local expiry | Disposable production Repository/cron expiry and reactivation tested; shared live subscription dates were not altered. |
| C04 | live cold start/bounded history + local103paging | Whole selected live history retained;103-save/member/subscription tests validate multi-page aggregation, not a100+live-data claim. |
| C05 | live score reconstruction + local counterfactuals | Real article scores/MMR match; controlled dates/diversity/chunk dedup tests pass without mutating shared publication baseline. |
| C06 | passed-live + local arithmetic | Actual Collection6 score/member ranking reconstructed; separate deterministic member-rerank test. |
| C07 | passed-live | Saved/own/subscribed exclusions; subscribed Collection's unsaved public articles remain candidates. |
| C08 | live publication/revocation + local after-recall change | Retained ordinary unstar/restar live evidence; private PDF excluded; controlled hydration-time revocation tests preserve other identity. |
| C09 | actual used filters live; optional since unverified natively | Live equality filters and deployed types; app forwards exact `$gte` locally. Installed CLI typo invalidated its original range probe, not the application. |
| C10 | passed-live | Recommended content saved through ordinary action, private vector/profile updated, source excluded; normal subscription removes Collection suggestion. |

No row above authorizes production deployment/backfill/cutover or clears deferred Security review. Default suite environment skips and local-only branches remain explicit even where bounded implementation tasks are checked.

## Historical test-owner verification — 2026-11-04 (pre-final media recovery)

Scope: this pass owns tests, the local `.local/vector-live` harness and standard checks. It does not replace the Security review, which remains unassigned to an available model. Branch `fix/android-storage-path-alias`, baseline HEAD `83534757`; no commit, reset, deployment, migration, production write, cloud provisioning or full-history run was performed.

### Standard commands and results

`SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=… LOGS_DATABASE_URL=…` was used for generation so no private operator configuration was read; placeholder DSNs were process-only values and are not recorded here.

| Command | Result |
| --- | --- |
| `pnpm api -- gen:all` | passed. Generated diff limited to `src/di/generated/dependency.ts`, `src/di/generated/readerRouter.ts` and `worker-configuration.d.ts` (+80/−3). It adds the five refresh/recommendation routes, `VectorMaintenanceService`, `ContentRecommendationService`, the four clients/repositories and the fourth `UserDeletionService` argument. `cronjob.ts`, `consumer.ts` and `apple-certs.ts` were byte-identical; no unrelated generator churn |
| `pnpm api -- typecheck` | passed |
| `pnpm api -- lint` | passed, 0 errors / 343 warnings |
| `pnpm api -- test` | passed: 214 files passed / 14 skipped; 3114 tests passed / 114 skipped. Skips are not claimed as verified |
| `pnpm api -- build` | passed: all four Worker `--dry-run` bundles |
| `pnpm api -- test:http` | passed on the standard port-8787 harness, including the loopback-only admission fixture (3 recorded maintenance admissions, owner-specific cleanup) |
| `pnpm api -- test:integration:local` | passed: 10 declared stages (migrations, collection read pagination/triggers/telemetry, tags, labs, payment, account revocation) |
| `pnpm exec openspec validate --all --strict` | passed, 92 items / 0 failures |
| `git diff --check` | passed |

An initial `gen:all` failed on `PrismaConfigEnvError: HYPERDRIVE_DATABASE_URL`; the same command with process-only placeholder values and the public template passed. This is a documented command prerequisite, not a code defect.

### 50 MiB PDF envelope: file limit, transport and measured memory

These are separate facts and must not be merged into one claim.

- Application file limit: `PDF_MAX_BYTES = 50 MiB` (`packages/contracts/src/pdf.ts`), enforced for upload and stored-original read. Upload/read of a 50 MiB PDF is supported.
- Current vector policy: `VECTOR_PDF_MAX_BYTES = 8,000,000`. A PDF whose original exceeds it is embedded from its stored extracted text only; the original body is not fetched for embedding. At or below the bound, the unchanged original is sent once as one PDF input; the provider returns page embeddings. The application does not split or reserialize PDF pages.
- Base64 transport overhead is 4/3: a full 50 MiB input would be 69,905,068 bytes in one provider body, which is why the full-file path was removed.
- Current measured Workerd result (`test/utils/vectorPdf.runtime.test.ts`, actual Miniflare): `largeOriginalBytes 52428800`, `largeOriginalReads 0`, `smallPages 40`; heap peak 10,606,964 B + backing 697,743 B = 11,306,707 B against a 64 MiB sampled budget; one PDF provider request for the small 40-page file with a >2 MiB response, and text-only requests for the large file.
- Historical measurement of the superseded full-original path (same 50 MiB, 16-page PDF): heap 67,770,456 B + backing 103,483,673 B = 169,186,939 B, 16 page requests each ≤12 MiB. That path exceeded the earlier 128 MiB sampled budget. It is recorded as a superseded measurement, not as the current policy.
- No supplier-side maximum is asserted from these local stubs; the Jina limit remains a provider-documentation question.

### Live bounded acceptance (local fixture + test account only)

Environment: local Workerd via the standard `pnpm api -- dev`, local PostgreSQL `slax-reader-backend-internal`, real Jina embeddings and real test Vectorize indexes `reader-test-v5-article|collection|user` under the already-authorized test account. Fixture users 7/8/9 and the ten historical markdown-only sources were reused; no production data was touched.

Observed across bounded runs. Correction 2026-11-05: the cited `.local/vector-live/v5-live-1793763478323-3ce4e3/evidence.json` was later overwritten by a failed preflight (`state: failed`, `checks: {}`) and no longer holds these results. The retained copy `evidence-before-final.json` in the same directory records eight passing checks from that run and ended in `timeout_private_copy_deleted`; later corrected evidence is in `.local/vector-live/repair-core-evidence.json` and `parallel-A-evidence.json`. Not every bullet below was re-verified against the retained copy:

- fixture preflight guards and unauthenticated rejection; `source_not_ready` for the known pending relation with no preference refresh;
- thirteen relation actions (one source-not-ready plus twelve committed relations), then native readback of every written vector with exact `a:<user>:<bookmark>` identity and metadata;
- article action scope (another user's shared save and the Collection/user vectors unchanged), Collection action scope and aggregate equality, no business-row or original-byte change;
- A/B independence for the same underlying bookmark: distinct `a:7:24` / `a:9:24`, cosine 0.9999715 between independent provider calls, `recommendable` true for the published owner and false for the private save;
- ordinary authentication and exact ID semantics; foreign and invalid IDs denied; legacy `/internal/v1/vector-refresh` absent;
- recommendations return published owner/member items only, exclude saved and subscribed Collections, keep a subscribed Collection's unsaved articles admissible, and exclude own Collections with a usable profile;
- subscription-only refresh recomputes the user Collection preference without touching article preference or Collection vectors; subscribe/cancel keep the two preference kinds independent.

Direct Workflow evidence for a new save: instance `v5-133576ff-8989-4b29-a05f-c9e2a6e3dab7` is `complete` with `article-write` (`a:9:38` written) before `article-visible` (successful after provider-lag retries) before `article-preference-write` (`u:9:article` written); the source row was `success` with its `updated_at` before the first step started.

### Failures, blockers and declared gaps

- Transient remote failures were observed and are not passed over: `VECTOR_GET_ERROR: Status + 500` from Vectorize reads, Edge `Network connection lost` (400) on a content read, and repeated `vector_mutation_not_visible` retries before a successful readback. Read-only recommendation reads and explorer reads now carry bounded retries in the harness; mutations do not.
- The local workflow engine left 29 instances from earlier runs in `running` after restarts and did not resume their retries. New instances completed after a clean restart; the stale set is not counted as evidence.
- Two harness instances were once started concurrently against the same fixture by separate sessions. That run's false recommendation/admission states are discarded; only sequential runs are treated as evidence.
- Fixture relation 35 keeps a pending capture claim; the ordinary add path correctly returns the existing bookmark without a second capture, and no operator retry endpoint exists in Reader. Recovery is recorded as a gap rather than bypassed with a database write.
- Not verified live in one completed run: star/unstar, archive/unarchive, trash/restore/permanent delete, import, Fork, media completion, PDF upload, >10-chunk replacement, all-history pagination and account deletion. Their unit coverage exists (see the files below) but is not a substitute for the live exercise, and they stay open.

Test-harness repairs made during this pass, none of which removes a behavioral assertion: text-only historical sources are compared by committed key identity instead of a missing HTML body; expected profiles consider only committed sources; Workflow step names are matched with their local `-<attempt>` suffix; read-only GETs retry up to three attempts and explorer reads two; failure reports carry phase and step. One threshold was corrected rather than the requirement: the same-source comparison for two independent real provider calls now requires cosine > 0.9999 after measuring 0.9999715, while distinct identity and the published/private `recommendable` flags remain hard assertions. Both local runs that exceeded the bounded retry window are recorded as failures, not retried until green.

Focused evidence files: `test/domain/vectorMaintenance.test.ts`, `vectorMaintenancePublication.test.ts`, `vectorMaintenanceHooks.test.ts`, `test/flow/vectorMaintenanceWorkflow.test.ts`, `test/handler/http/threeVectorRefreshActions.test.ts`, `test/handler/http/contentRecommendationController.test.ts`, `test/domain/contentRecommendation.test.ts`, `test/infra/vectorMaintenanceRebinding.test.ts`, `test/infra/vectorMaintenanceSync.test.ts`, `test/script/vectorArchitecture.test.ts`, `test/utils/vectorEmbedding.test.ts`, `test/utils/vectorSources.test.ts`, `test/utils/vectorPdf.runtime.test.ts`.

Open human gates are unchanged: the Security review (separate unavailable model), deployment, full-history refresh, provider-supplier limits, version decisions and post-merge archival.

## Continuation acceptance — 2026-11-04

This continuation follows the interrupted main-worktree session. It does not inherit a completed-feature claim from the sections below. The working tree and baseline remain unchanged; no commit, push, deployment, production refresh or schema change is performed.

- Standard `pnpm api -- gen:all` passed. The initial typecheck exposed the interrupted media Runner callback integration; the two existing media Workflows now resolve the registered MediaSnapshotService for that callback. A subsequent typecheck passed.
- `pnpm api -- test:integration:local` passed against its own disposable databases; its historical migrations do not alter the application's current development or production database.
- `pnpm api -- build` completed all four Worker dry-run bundles. This is not a deployment.
- An intermediate full-suite run while the delegated media/recommendation edits were still in progress failed. Lint also reported three formatting errors in those in-progress files. Neither result is waived; the final tree must be checked again.
- Read-only Wrangler inspection of test account `52bb95cdad45ee5441e67b3a1e9dce5b` confirmed the three `reader-test-v5-*` indexes use 1024 dimensions and cosine. Article indexes include numeric `user_id`, string `kind`, boolean `recommendable` and numeric `published_at`; Collection includes boolean `recommendable` and numeric `published_at`; the user index has no metadata indexes. The article and Collection indexes also retain legacy `generation`, `recipe` and `recipe_digest` metadata indexes (plus Collection `kind`). No remote index was removed or created in this continuation.
- The pre-continuation ordinary-route evidence ended with HTTP 200 but Domain `state: failed` / `vector_operation_failed`; that is not a pass. Actual new-save Workflow completion and final ordinary-route/provider/index acceptance remain open until the current runtime failure is repaired and exercised.

## Main-worktree architecture correction — 2026-11-04

The user required the existing project architecture, not another manually constructed runtime. This pass replaces the server-side maintenance factory with an injected `VectorMaintenanceService`; PostgreSQL queries live in `VectorMaintenanceRepo` and `ContentRecommendationRepo`, which inject the existing lazy Prisma client. Provider HTTP and R2/Vectorize access live in registered infrastructure clients. `DatabaseRegistry` remains the connection owner and `ContextManager` owns cleanup. Controllers validate HTTP input and resolve or inject Services; the maintenance Workflow initializes the normal container and does not construct a Pool or execute SQL.

Subscription expiry again uses one set-based database update with returned changed users. Vector admission runs afterward and cannot prevent the database update. Sync Repository code no longer imports maintenance Domain hooks or owns request `waitUntil`; the existing Orchestrator observer handles committed identities. Unnecessary maintenance-hook dynamic imports are removed. The local refresh CLI no longer creates checkpoint/result-state files, stores receipts, or implements resume polling; its explicit `--after-id` is an operator-provided cursor for one kind. The API returns the shared `written/deleted/empty/failed` processing states without calling acceptance query visibility a completed migration.

Current commands on `/Users/daguang/project/slax-reader`:

- `pnpm api -- gen:all`: passed. DI/router/environment outputs were regenerated, not edited by hand; generated constructors now resolve the injected Repository/Service graph.
- `pnpm api -- typecheck`: passed.
- Focused architecture/Controller/Edge/CLI checks: 5 files, 96 tests passed, including 18 architecture-boundary checks.
- `pnpm api -- test`: 213 files passed, 14 skipped; 2,906 tests passed, 113 skipped.
- `pnpm api -- lint`: 0 errors, 343 warnings.
- Public-template `pnpm api -- build`: all four dry-run bundles passed.
- `pnpm exec openspec validate --all --strict`: 92 passed, 0 failed.
- `git diff --check`: passed.

Runtime verification is recorded separately. Two earlier `pnpm api -- dev` launches failed at the existing Cloudflare Pipeline remote-preview binding with error 10021; no binding was removed to bypass that failure. A subsequent exact `pnpm api -- dev`, with no extra arguments or environment overrides, started all four standard ports from the main worktree. Actual authenticated read-only requests through the generated DI chain returned HTTP 200 for article recommendations (9 items) and Collection recommendations (1 item); both anonymous requests returned 401. The earlier Pipeline error did not reproduce and is not a current startup blocker; its cause was not established.

The standard isolated HTTP smoke initially failed account cleanup because its test environment omitted the new maintenance binding. After adding an explicit loopback-only admission fixture, the rerun passed, including original bookmark/diagnostic cleanup and four recorded maintenance admissions. This smoke does not execute the model or Vectorize. Previous real Jina/test-Vectorize write results belong to the pre-architecture version and remain supporting evidence only. New-save/deletion end-to-end acceptance, the previously reported lifecycle defects, and the 50 MiB PDF memory envelope remain unclosed; architecture verification is not a finished-feature or release claim.

## Superseded history

> Historical recovery evidence only. The entries below concern superseded source/daily/frozen-foundation implementations and other worktrees; their checked counts and acceptance statements do not validate the current main tree. Bot/source work is cancelled and intensive/daily reading is deferred. The approved DI-registry/Repository/Service/Controller/standard-Workflow architecture and stateless bulk CLI still require current integrated runtime/provider acceptance. No historical result is promoted to a new pass by this revision.

## Status and authorization

2026-11-02: the parent relayed explicit human approval to apply the presented B/C proposals and for C to add pdf-lib. B implementation began in `/Users/daguang/project/slax-reader-vector-v5`, branch `feat/vector-v5-recommendation`, baseline `cfd51f55`. No commits, pushes, merges, rebase, deployment, cloud provisioning, production migration/backfill or paid provider calls were performed. No secret files or other worktrees were modified.

This remains a partial implementation, not a released or fully integrated feature. In the continuation pass, source/daily routes are now registered through decorators/generators, Edge and Core enforce dedicated machine/user boundaries, concrete bounded asset validation/staging is implemented, and the independent batch job repository has a generated/local-tested PostgreSQL migration. Actual Worker HTTP confirms valid source/daily requests return explicit storage-unavailable 503 until real adapters are supplied. No test repository is installed in production. Shared C writer/foundation, source member/curation transactions, daily repositories and business lifecycle wiring remain incomplete. The later continuation section supersedes the earlier checkpoint counts and gaps below.

## Implemented source

- `packages/contracts/src/daily-reading.ts`, `ingestion.ts`, `index.ts`, and `test/recommendation.ts`: additive mixed daily items, source-member references, candidate/batch/selection/publication contracts and compiled consumer fixtures. Legacy collection/save contracts were not changed.
- `apps/api/src/utils/recommendation/ranking.ts`: validated versioned ranking policy, compatible multi-target merge, canonical dedup, exclusion filters, bounded member relevance and mixed-kind assembly.
- `apps/api/src/utils/recommendation/edition.ts`: local-date/DST handling, owner/edition/version cursor validation and immutable ordinal pagination.
- `apps/api/src/domain/sourceCuration.ts`: candidate-only staging; source/resource duplicate delivery tracking; Collection-specific event groups; versioned quality-evidence selection/no-winner; explicit publish/withdraw with current readiness/moderation/eligibility checks; operation replay; no personal bookmark writes.
- `apps/api/src/domain/sourceIngestion.ts`: bounded batch validation/digest, idempotent job admission port, bounded staging consumer and source-scoped job status. Candidate readiness is separate from publication.
- `apps/api/src/domain/preferenceConsumer.ts`, `recommendationPorts.ts`, `vectorRuntimeConsumer.ts`: B structural ports matching C's four writer methods, desired-state mapping, all-history page/resume consumption, outstanding/ack handling without sequence commit assumptions, profile materialization freshness fallback, article lifecycle delegation and published-accessible member reconciliation. No shared codec, accumulator subtraction or normalization algorithm is duplicated.
- `apps/api/src/domain/contentRecommendation.ts`: configured shard query fanout, authoritative admission before dedup and again before return, bounded refill and failed-target reporting.
- `apps/api/src/domain/dailyReading.ts`: immutable issue/refresh and feedback over explicit storage/generator/admission ports, preserving old cursors and current exclusions.
- `apps/api/src/handler/http/sourceCurationHandler.ts`, `sourceIngestionHandler.ts`, `dailyReadingHandler.ts`, and `apps/api/src/utils/sourceMachineAuth.ts`: bounded request adapters, dedicated synthetic-testable machine digest verification, source scoping and safe errors. Production credential setup/Edge/Core registration are not implemented.

## Commands and results

All shell commands used the B worktree as explicit cwd. Standard commands used `SLAX_API_SKIP_DOTENV=1`; no .env/.dev.vars was read or borrowed.

1. Existing locked API/contract dependencies installed with `pnpm install --frozen-lockfile --ignore-scripts --filter slax-reader-backend... --filter @slax-reader/contracts`, worktree-local store/cache/state. Initial registry timeouts were retried successfully. No dependency declaration, lockfile or version changed.
2. `pnpm api -- gen:all`: initially failed because `HYPERDRIVE_DATABASE_URL` was absent. Repaired through supported `pnpm api -- config:init` using the checked-in public template and a newly owned disposable PostgreSQL 17 container on an allocated loopback port. Both required generation URLs referenced that actual disposable container; no guessed/production connection was used. Final gen:all succeeded. Container removed by trap. Generated tracked DI/router/consumer/Worker type files have no diff. The ignored local api.toml is template-only and not deployment-ready.
3. `pnpm api -- lint`: final PASS, 0 errors and 344 existing warnings. Initial new formatting errors were fixed with scoped repository Prettier, not broad unrelated edits.
4. `pnpm api -- typecheck`: final PASS, including `@slax-reader/contracts` source and consumer fixtures. Initial missing generated Prisma clients and one new TextDecoder options mismatch were corrected before final run.
5. `pnpm api -- test`: final PASS, 207 test files passed / 14 skipped; 2746 tests passed / 113 skipped (2859 total). Earlier missing-generated-client failures were resolved by standard generation. Skipped tests are not claimed verified.
6. Focused new tests: 8 files / 29 tests PASS using the existing API Vitest command: sourceCuration, sourceIngestion, vectorRuntimeConsumer, recommendationRanking, preferenceConsumer, dailyReading, sourceCurationRuntime, dailyReadingHandler.
7. `pnpm api -- build`: final PASS for Core/Edge/AI/Browser via the repository's `wrangler deploy --dry-run` build script. No upload/deployment occurred. Existing contracts sideEffects warning remains.
8. `pnpm api -- test:http`: after generation repair, PASS with actual disposable Worker HTTP requests and PostgreSQL/D1 migrations through the existing harness. Authentication/readiness/bookmark CRUD and diagnostics smoke completed; the harness removed its owned container. This is existing app regression evidence, not new route registration evidence.
9. `pnpm api -- test:integration:local`: final PASS for collectionReadPagination, PostgreSQL/logs historical migrations, tagIntersection, tagRepo, labRepo, collectionTriggers, collectionTelemetryLogs, paymentPostgres and accountRevocationPostgres. Its newly owned container was removed. These are local-only historical migrations; B/C new business schema was not generated or applied.
10. `pnpm exec openspec validate --all --strict --json`: PASS, 94 items / 0 failures. `git diff --check`: PASS.

## New running-service evidence

`test/handler/http/sourceCurationRuntime.test.ts` starts an actual Node HTTP server on loopback with an ephemeral port, uses fetch over the socket and closes it. It invokes the production curation handler, service and credential verifier with synthetic credentials and a test-only transaction store. Observed: user JWT rejected 401; candidate accepted 200 while membership stays empty; caller-supplied publication flag rejected 400; internal processing-ready still publishes nothing; explicit select then publish creates one member; replay adds none; withdraw removes it; old publish version fails 409; oversized body fails 413. No external model/network source calls.

`test/helpers/curationStore.ts` is explicitly fixture persistence, not a PostgreSQL replacement shipped in production. Domain tests cover a group with two candidates/one winner, no winner, moderation rejection, source isolation, independent Collection choices, closure, stale revisions, canonical/alias replay, unselected-alternative updates, private/staging candidate admission exclusion, compatible cross-shard ordering, full history over three pages, late lower outstanding IDs, zero/stale profile state, stable daily pagination/refresh/feedback and synthetic credential expiry/revocation. C arithmetic/idempotency itself is delegated and not reimplemented or asserted proven by these spy tests.

## Local review

Bugs pass: fixed alias revision ownership/retry conflict, prevented unrelated candidate updates clearing a winner, and moved recommendation authorization before canonical dedup. Added assertions for these paths.
Security pass: machine credentials do not fall back to user JWT/API key; no public metadata-only admission; ingestion cannot set moderation/publication flags; publish revalidates current eligibility even on replay; JSON input is bounded and strict; response errors do not log private bodies. Production asset fetch validation, credential configuration and Core/Edge authentication integration remain open, not waived.
Compliance pass: mandatory text/images/PDF, full-history profiles and C ownership remain unchanged; approved curation requirement is added to existing B capability specs; only independently verified tasks are checked. No B foundation DDL or private Bot code was added. Feature remains incomplete and must not be proposed as ready to release.

## Required integration and unfinished work

- Parent must integrate C's reviewed shared patch into B. Required paths: `apps/api/src/utils/vectorV5/index.ts` / `contract.ts`, `apps/api/src/domain/vectorV5.ts`, `apps/api/src/infra/repository/dbVectorV5.ts`, shared source/vector schema and generated clients. One read of C's actual contract confirmed signatures and `isPublishedSourceMember`; no import/copy from a sibling path is used.
- Connect structural ports to real `reconcile`, `verify`, `reconcileContribution`, `publishAggregate`, query encoding, bucket querying, aggregate-by-ID and committed/immutable representation readers; confirm bounded history/outstanding-ack adapters. No live vector buckets or multimodal provider call was exercised.
- Finish B curation/selection/daily persistence and transactional membership effects after C DDL. Independent job persistence is implemented. Production CurationStore must lock/paginate real rows and atomically commit B receipt/state plus C member/ledger effects; missing C transaction/FK contracts are listed precisely in design.md.
- Supply production ReaderRecommendationRuntime source/daily adapters, queues/cron/current-account settings/save-subscribe bindings and REST/sync/article/PDF/Fork/deletion hooks. Authenticated generated routes now exist, but intentionally return 503 instead of fabricated success when these adapters are absent.
- Finish actual source Collection public detail/counts/subscription/PowerSync projection and published-only admission against real storage; prove withdrawal/closure updates real Collection/user buckets.
- Integrate approved source manifest/upload issuance and concrete SourceAssetService with the production source adapter. Bounded fetch/read/hash/signature/source checks are implemented and tested; successful asset staging does not imply parsing, moderation, PDF page completeness or embedding success.
- Integrate C mandatory image/PDF writer/segmenter, all-history accumulator and verification; full numeric recomputation, provider output mapping, real capacity and release cutoff remain unverified.
- Daily scheduler/pending-job semantics, durable refresh/feedback races and existing save/Fork/PDF/subscribe end-to-end remain incomplete despite service-port tests.
- UI/platform selection and human acceptance are independent pending decisions; parent handles application-version questions. No version bump, UI delivery claim or new dependency is made by B.

## Continuation: concrete assets, protected routes and independent persistence

This checkpoint supersedes earlier route/asset/job-persistence gaps. Tasks 7.4 and 7.6 are newly complete: 10/53 checked, 43 open. C was not polled, read again, copied or modified during this continuation.

### Source and generated files

- New `domain/sourceAssets.ts`: real R2 adapter, source-scoped trusted manifest lookup, bounded text/image/PDF byte reads, publicTarget/createPublicFetch reuse, per-hop HTTPS/origin gates, actual MIME/signature/length/SHA-256 validation and source staging writes. New `test/domain/sourceAssets.test.ts` has 15 cases covering private/credential URLs, redirects/loops, hash/signature/size/type failures, text/PDF/raster images, source prefix/revocation, timeout/storage errors and actual candidate admission integration. `packages/contracts/src/ingestion.ts` adds text assets.
- New `middleware/sourceIngestionAuth.ts`, `domain/readerRecommendationRuntime.ts`, `handler/http/sourceIngestionController.ts`, `dailyReadingController.ts`; modified `middleware/auth.ts` and `entry/edge/index.ts`. Exact machine routes are authenticated before any personal key or trusted-user shortcut; Core verifies again. Optional generator-owned settings default disabled/missing; valid credentials with null real adapters return no-store 503. No fixture provider is registered.
- Updated `script/gen-routers.ts`, `script/generate-worker-types.ts`; ran gen:all and inspected generated `src/di/generated/dependency.ts`, `readerRouter.ts`, `worker-configuration.d.ts`. New controller catalogue tests updated in `test/script/generatorPaths.test.ts`, including its last-fixture import expectation.
- New `infra/repository/dbSourceIngestion.ts` and `test/infra/sourceIngestionPostgres.test.ts`; additive Prisma model plus generated `prisma/pg_migrations/20261102111126_source_ingestion_jobs/migration.sql`. Only the independent B job table is created; no source identity/member/subscriber/vector foundations or C FK definitions.
- Fixed `sourceCuration.ts` to use actual asset service or fail closed, reject private target URLs, and clear selection on withdrawal/moderation revocation; fixed `sourceIngestion.ts` to keep 429/5xx asset failures retryable; fixed `preferenceConsumer.ts`, `vectorRuntimeConsumer.ts` and `utils/recommendation/edition.ts` to validate complete pages/phase/ownership before contribution writes and reject invalid empty-page cursors. `recommendationBoundaryReview.test.ts` covers these regressions.

### Commands and actual results

- `pnpm api -- gen:diff --name source_ingestion_jobs` used a newly owned PostgreSQL 17 container on a discovered loopback port. Inspected the generated SQL: one CREATE TABLE and two indexes, no destructive SQL or C schema. Applied with the PostgreSQL component `pnpm api -- migration:local:pgsql` because D1 did not change, then `gen:all`. All succeeded; the container was retained only for the explicit repository test and then removed. No remote migration.
- `SOURCE_INGESTION_TEST_DATABASE_URL=<owned-loopback-db> pnpm api -- test test/infra/sourceIngestionPostgres.test.ts ...`: 42 focused tests passed including real concurrent batch admission, payload conflict, source-scoped reads/outcomes and no stale-failure overwrite. This repository test is intentionally skipped without an explicit disposable local URL.
- `pnpm api -- test`: final 210 files passed / 15 skipped; 2769 tests passed / 114 skipped. Two runs caught stale exact controller-list/import assertions; both were repaired and the test and full suite rerun successfully. No red tests remain in the final run.
- `pnpm api -- lint`: PASS, 0 errors / 344 warnings. `pnpm api -- typecheck`: PASS. `pnpm api -- build`: PASS for all four Workers, --dry-run only.
- `pnpm api -- test:http`: actual local Workerd Edge/Core plus disposable PostgreSQL/D1; added generated source/daily route assertions. User JWT to source route returned 401; valid machine calls to batches/candidates/selections/publish/withdraw returned 503 source_ingestion_storage_unavailable; authenticated daily GET returned 503 daily_reading_storage_unavailable; publish-extra returned 404. Existing bookmark CRUD, fulltext, diagnostics and privacy smoke passed. First attempt was interrupted by a concurrent generated-file reload/network response; rerun with stable generated files passed.
- `pnpm api -- test:integration:local`: all existing PostgreSQL/logs migration, Collection pagination/triggers/telemetry, tag/lab/payment/account revocation groups passed with the additive job migration present. Owned containers were removed.
- `sourceIngestionBoundary.test.ts`: five cases, including a real loopback socket reaching actual Edge auth, Core middleware and generated router without a production fixture repository. Covers exact paths/methods/scopes/config, spoofed Edge identity, API-key rejection and credential forwarding.

### Review and remaining concrete blockers

Bugs review fixed withdrawal eligibility reuse, permanent classification of transient asset failures and mixed/invalid page writes. Security review confirms source manifests cannot select foreign storage or arbitrary redirect origins, bytes are validated before staging, machine credentials never acquire user identity, and absence of production state cannot report success. File magic checks are admission checks, not full PDF parsing/OCR/visual completion; that remains C's domain.

Production success paths still require the exact handoff table in design.md: C writer methods; allowlisted physical query adapter; committed/materialized/immutable representation reads; full-history/outstanding acknowledgement entrypoints; same-PostgreSQL-transaction source Collection eligibility and member publication/withdrawal adapter. B's CurationStore transaction must commit candidate/group/receipt changes with that member effect and C's ledger, not merely enqueue a best-effort hint. Missing actual FK types/transaction exports prevent safely generating those dependent B tables. The independent job table demonstrates persistence work continued without fabricating the blocked foundation.

At that earlier checkpoint, source adapters and dependent persistence were absent. The authorized C handoff integration below supersedes those specific blockers; it does not erase unfinished production acceptance.

## Authorized C handoff integration

Parent authorized importing C's frozen 22/56 slice. New shared runtime/writer/source/repository files, admin dispatcher, tests/harnesses and both C migrations were copied only when absent in B. Overlaps (Prisma schema, AI/Core/Edge entrypoints, generator settings, deployment source and public template) were merged explicitly; B ingestion job/schema and source machine routes remained. Generated DI/routes/Env/clients were regenerated, not copied. The exact approved pdf-lib@1.17.1 was added with pnpm; the lockfile delta matches C's 27 additions and no unrelated upgrade. C capability planning files were not duplicated in B.

`shared-import-baseline.json` records first-import SHA-256 for shared source and both migrations. A later read-only hash comparison found C source contents had changed for contract/codec/runtime/domain writer/backfill/repository/source files despite the reported freeze. B retained its first copied slice and did not chase/overwrite it; parent must reconcile subsequent C improvements explicitly. Both handed-off migration SQL files remain byte-identical.

### Real implementations added in this integration

- `PgSourceCurationStore` uses real C `readSourceCollection/readSourceMember/stageSourceCandidate/isArticlePublishable/applyMemberPublication` on the same VectorSql transaction as B state, selection and operation receipts. A Collection row lock serializes winners; actual forced rollback test confirms B receipt/member/ledger all roll back. B state is bounded to 1000 candidates/5000 receipts per Collection; scalable paginated normalized curation remains a disclosed limit rather than silent dropping.
- Generated B migration `20261102124759_recommendation_curation_daily` adds curation state, immutable daily edition/version, feedback/operation receipts and maintenance checkpoints. Clean PG17 replay order is C foundation 101529 -> B jobs 111126 -> C publication 120124 -> B curation/daily 124759. No handed-off SQL/history was rewritten.
- `recommendationRuntime.ts` now constructs actual PostgreSQL, Prisma job store, C VectorV5Service/codec/source/buckets and B services. `ReaderRecommendationRuntime` defaults to these real factories; missing configuration still fails closed. No fixture repository is wired into production.
- `SourceCandidateProcessor` exposes source-scoped Collection upsert, bounded process and review actions; source candidates capture missing canonical content through `SourceAssetCapture` from already verified text/image/PDF assets. Existing canonical/user articles are not overwritten. Review is explicit, persists a basis, and never replaces current access/moderation checks. No crawler or LLM scorer/rewriter was added.
- `SharedRecommendationMaintenance` consumes all paginated C saves/subscriptions/members/applied contributions with durable per-target continuation, publishes C aggregates and reads materialized preferences via VectorV5RuntimeAdapter. No duplicate vector arithmetic. `recommendationHooks.ts` accelerates committed REST/sync mutations while C triggers remain the durable record. Targeted fanout/concurrency stress remains open.
- `PgRecommendation`, `PgDailyReadingStore`, actual generated daily routes and bounded cron implement source-publication-aware recall, deterministic configurable content policy, mixed immutable editions, refresh and feedback/undo. PostgreSQL authorization is rechecked at response time; staging metadata cannot grant access. Current production recall/hydration supports source Collections; full legacy-public Collection recommendation and advanced policy features remain incomplete.
- Existing Collection subscribe/unsubscribe/delete/status endpoints now resolve source codes against C subscriber table. Existing bookmark add_url accepts optional source_member and calls BookmarkService save logic to create a real user relation while preserving canonical original bytes. Real Worker duplicate save and subscription calls succeed without fake source users. Full private Fork/provenance and PowerSync source projection remain incomplete.

### Shared safety repairs made in B only

1. Real Workerd rejected C codec `Request.redirect='error'` before reaching the offline provider. Changed to `manual`; existing non-OK handling rejects 3xx, and regression verifies no redirect follow. Original hash remains recorded. No provider call was made.
2. Withdrawal left active subscribers referencing an empty Collection, and shared validation refused removal despite a zero aggregate. Added a narrow removal eligibility case only when existing committed Collection accumulator rows have zero weight and all components within 1e-10 of zero; B maps C cold-start result to removal. Real PG and Workerd withdrawal now converge. This needs parent/C review alongside broader zero-norm and concurrency tests, not a full shared acceptance claim.
3. PostgreSQL JSONB reorders keys; B immutable candidate retries falsely conflicted. Candidate input is reparsed through its strict schema before payload comparison. Actual PG replay test now passes.

### Actual integration evidence

- `test/runtime/vectorBackfillMigration.ts`: clean PG17 chronological replay of all shared/B migrations and gen:all passed.
- Shared focused tests: vectorSourcePublication/vectorV5/vectorV5Writer/vectorV5Rpc/vectorBackfillLifecycle, 15 tests passed with actual shared SQL/code and explicitly offline external transports.
- `RECOMMENDATION_TEST_DATABASE_URL=<owned PG17> pnpm api -- test test/infra/recommendationIntegrated.test.ts`: actual C+B transaction scenario passes. Two candidates remain private; one selected original publishes once under concurrent replay; forced transaction failure rolls back member, receipt and ledger; real Collection/user aggregates are normalized; daily versions/feedback/undo/user isolation persist; subscription excludes the Collection while retaining its new article; withdrawal removes public admission and empties aggregate without deleting user saves.
- `pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationSmoke.ts`: actual local workerd, generated HTTP routes, PG17, R2 and D1; only Jina and vector-index transports are test substitutions. Success sequence: source Collection -> asset/candidate -> actual shared processing -> explicit review/selection -> publish/replay -> mixed daily GET -> existing subscribe -> refresh -> existing add_url source save/replay -> withdrawal -> filtered refresh. Additional stored image/text fusion and original PDF binary/extraction/shared processing pass. No provider-output or large-document memory claim.
- Additional real PG17 scenario covers 103 saved resources over persisted one-page work budgets (more than two pages), replay without duplicate contribution, star weight 103 -> 104, unstar/archive neutrality and deletion to 102. Component-wise raw sums match full contribution recomputation at absolute tolerance 1e-8. The same run checks real immutable edition feedback and member/receipt/ledger transaction rollback. This is not a production concurrency/lease stress claim.
- Initial fixture issues (syntax, relative tsconfig, local Hyperdrive password requirement and codec redirect compatibility) were resolved and rerun; none is presented as passing before repair.
- Final standard gen:all/typecheck/lint (0 errors, 345 warnings)/four dry-run Worker builds passed. Combined standard test:http preserves B rejection tests and adds C machine dry-run idempotency/no-dispatch assertions; local integration suite passed. No production writes/resources/deployment.

### Remaining concrete work and release blockers

At this first integration checkpoint, token subdivision, shard/fencing and targeted dependency correctness were still open. The parent later confirmed C's changed hashes were authorized repairs and supplied the frozen repair slice. The second explicit merge below supersedes those local correctness gaps; real supplier/PDF memory and broad production stress remain open.

Additional verified implementations: source-specific `/v1/source-collection` list/count/member reads are backed by current C publication/permission state; actual PG tests prove unselected exclusion and withdrawal revocation. `searchOwnedV5` plus disabled-by-default VECTOR_V5_SEARCH_ENABLED switches query/passage together, using current owned/tag IDs before recall and the existing final ownership recheck. Real C/PG retrieval tests only return the supplied owned ID; legacy search metadata/highlight/filter tests pass. No operator activation occurred.

Final full suite: 220 files passed / 16 skipped; 2801 tests passed / 116 skipped. Explicit actual-PG integrated run: 2 scenarios (publication/daily/feedback/actions/rollback and 103-history arithmetic) pass. Shared PDF Worker test passes. Standard build/lint/typecheck/gen and strict OpenSpec 94/0 pass; repository cron inventory required a legitimate new-job assertion update, then complete suite passed. Runtime smoke additionally covers real batch idempotent admission/dispatch/job status before curation; this is no longer a 503-only test.

B remaining: source PowerSync projection with tested finite-expiry revocation (an unverified never-expiring-only attempt was removed, leaving existing sync rules unchanged); complete Fork/private snapshot provenance; legacy public Collection recall and advanced Collection ranking; complete lifecycle/account-deletion/durable fanout coverage; normalized/paginated curation beyond explicit capacity cap; per-user daily enablement and long-running refresh scheduling; broad contention/old-cursor acceptance and production-source manifest issuance. Source public HTTP currently requires normal Reader authentication; anonymous Collection presentation is not claimed. Review scoring is a privileged source action, not an implemented private Bot scorer. All corresponding tasks remain unchecked; no production-ready claim, release, version increment, commit or paid sample.

## Second authorized shared repair integration

Scope: one coherent file-level integration of C's eight-finding fix. Read the parent-designated agent-84a3rrcg handoff and C validation repair section. C stayed read-only. Prior hash changes are explicitly acknowledged as authorized follow-up repairs. Original `shared-import-baseline.json` hashes remain intact, with appended pointer to `shared-repair-snapshot.json`. No dependency/version changes, commits, merges, deployment, production access or paid calls.

### Imported/merged files

The repair snapshot lists full before/C/merged SHA-256 values. Shared files: `domain/vectorBackfill.ts`, `domain/vectorV5.ts`, `infra/repository/dbVectorBackfill.ts`, `dbVectorV5.ts`, `vectorV5Sources.ts`, `utils/vectorV5/{runtime,codec,buckets,pdf,contract,index}.ts`, new `writeGate.ts`. Repaired tests/harnesses: `test/infra/vectorV5.test.ts`, `vectorSourcePublication.test.ts`, new `vectorWriteGate.test.ts`; `test/domain/vectorV5Writer.test.ts`, new `vectorV5Repairs.test.ts`; `test/utils/vectorV5Inputs.test.ts`; `test/script/vectorBackfillLifecycle.test.ts`; `test/runtime/vectorBackfillMigration.ts`, new `vectorRepairsSmoke.ts`.

Only the new `sr_vector_shard_write` model was appended to B Prisma; C migration `20261102130653_vector_v5_write_gate` was copied unchanged. All B tables and the four existing handed-off migrations remain. Regeneration used standard tools, not copied generated files.

B consumers updated: `sharedRecommendationMaintenance.ts`, `sourceCandidateProcessor.ts`, `sourceAssetCapture.ts`, `recommendationHooks.ts`, `preferenceConsumer.ts`, `recommendationPorts.ts`, `vectorRuntimeConsumer.ts`, `infra/recommendationRuntime.ts`, `handler/http/dailyReadingController.ts`. New `test/domain/recommendationRepairConsumption.test.ts`; extended `test/infra/recommendationIntegrated.test.ts` and boolean-ack fixtures in `test/domain/preferenceConsumer.test.ts`. JSONB canonicalization, original source-scoped auth, receipt/publication gates and unrelated B work remain preserved.

### Semantic acceptance

- B PDF capture now writes `text_status`; failed/pending sidecars and missing ordinary body remain incomplete even with image/PDF bytes. Actual PG processing cannot approve/publish either missing-body case.
- B aggregate checkpoints persist one `eligibilityCutoff` used in history paging and removal/add transactions. Completion reports `verified_as_of` / `current:false`, not an always-current certificate. C final verification tests reject internally consistent but expired contributions.
- B count-only ack logic was corrected: false increments pending, not acknowledged; live hook leaves unresolved events outstanding. Actual PG event remains pending when dependent article/Collection is unready.
- Gate/lease/cleanup wait outcomes are not passed to verify an old ready manifest. Partial/terminal outcomes carry reason/retryability/delay to the source response; source public eligibility is false until ready. Daily terminal gaps return unavailable; transient work remains pending.
- C's new fixed-time expiry/fanout/fencing/capacity/subdivision behavior is integrated without reimplementing algorithms. Tokenless low-level writes are never used by B.

### Minimal return-to-C patch (do not copy all B files blindly)

All hashes are full in shared-repair-snapshot.json; here are 12-character prefixes (C repair -> B merged):

| File | Before -> After | Exact change |
| --- | --- | --- |
| `apps/api/src/utils/vectorV5/codec.ts` | `ec0b568bde0c` -> `d900fb82980c` | Request redirect remains manual, not unsupported error; non-OK 3xx is rejected without following. B existing regression and actual Workerd exercise retained. |
| `apps/api/src/infra/repository/vectorV5Sources.ts` | `055f82d2e589` -> `53681deff2ab` | Active subscription removal only with existing committed zero-weight 1024 finite near-zero sum rows and no remaining Collection contributions. Missing representation, missing accumulator or nonzero-weight cancellation is not empty. |
| `apps/api/src/domain/vectorV5.ts` | `43f92b327b83` -> `e0b1ba03169e` | Before cold-start cleanup, reject aggregate_nonempty_zero_vector if committed weight/sum or applied records are nonempty, preventing downstream purge on vector cancellation. |

The last two hunks are one exact-empty correctness concern: preserving only validation is insufficient because cold-start cleanup itself can remove dependents before validation. Actual PG regression inserts a nonzero-weight zero-vector aggregate plus dependent subscription and proves publish fails terminally without deleting that subscription. Existing confirmed-empty withdrawal success still passes. Parent must route these minimal hunks and their tests back to the same C owner before early C deployment. No C tree was modified.

### Commands/results

All shell cwd was the B tree; dotenv loading disabled.

1. `tsx --tsconfig tsconfig.json test/runtime/vectorBackfillMigration.ts` via API pnpm exec: clean PostgreSQL 17 replay/gen passed, exact order 101529 -> 111126 -> 120124 -> 124759 -> 130653. Earlier migration hashes rechecked unchanged.
2. Focused C eight-finding suite (`vectorV5`, `vectorWriteGate`, `vectorV5Repairs`, `vectorV5Inputs`, `vectorSourcePublication`, `vectorV5Writer`, retained B codec test): **49 passed**. Covers red-to-green C cases for body, sidecar, expiry snapshot, dependency ack, r1/r2, lease fencing, pending capacity, terminal 404/single page and deterministic text/PDF subdivision.
3. B focused consumer suite: **27 passed** across repair-consumption/preference/curation/daily handler tests, including 10 new repair-semantic cases. These are unit ports, not falsely called end-to-end.
4. Actual owned PostgreSQL17 `recommendationIntegrated.test.ts`: **4 passed**, including candidate->selection/publication->Collection/user->daily->subscription->withdrawal; forced rollback/replay; 103-resource bounded history/recompute; exact-empty/cancelling/missing representation; missing image-article body/PDF sidecar and false ack retained. Final actual PG rerun with C writer repair and B semantics suite: **23 passed**. Container removed in trap.
5. Actual `test/runtime/recommendationSmoke.ts`: **passed** on workerd + real PG/R2/D1 + actual C/B implementations. Batch/dispatch/quality-selection/publication/Collection/user/daily/save-subscribe/replay/withdraw plus stored image/PDF paths pass. Only provider/index are clearly offline transports; no external supplier acceptance claim.
6. Actual `test/runtime/vectorRepairsSmoke.ts`: **passed** PostgreSQL17 simultaneous shard admission, stale describe accounting and expired save/publication/cleanup/purge rejection; container removed. Workerd PDF suite: **1 passed**.
7. Standard gen:all, typecheck, lint (**0 errors,345 warnings**), four Worker dry-run builds: passed. Initial B processing-state variable collision was fixed and rerun.
8. Final full `pnpm api -- test`: **223 files passed,16 skipped;2833 tests passed,118 skipped**. The named PostgreSQL scenarios above were exercised separately with explicit owned database configuration; other skips are not claimed verified.
9. Standard `test:http` first run hit a local service connection-loss 500 while other validation ran. Unchanged serial rerun passed actual C admin dry-run, B source auth/unavailable checks, user bookmark CRUD and diagnostics. `test:integration:local` serial run passed every declared stage; all owned containers cleaned.
10. After the final nonempty-zero-vector publication guard, repeated `SLAX_API_SKIP_DOTENV=1 pnpm api -- lint`, `typecheck` and `build`: all passed (0 errors/345 warnings; four Worker dry-runs). Repeated `SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationSmoke.ts`: passed on the final code after clean replay of all 62 migrations; its owned container was removed. `pnpm exec openspec validate --all --strict --json`: 94 passed/0 failed; `git diff --check`: passed. Independent SHA-256 checks matched all 22 frozen C repair files and all 22 expected B merged files, including three explicit overrides; both original shared migration hashes are unchanged. Original baseline retains 36 hash entries. Task count remains 24 checked/29 open; HEAD remains cfd51f55. Final audit found no B-owned test containers, B Worker processes or active background tasks.

### Completion and limitations

This repair added no new product scope and did not automatically complete original open tasks. B remained **24/53**, 29 open at that checkpoint. The eight reviewed local shared defects and B consumption boundaries were regression-covered. The following authorized business implementation supersedes specific B product gaps, not supplier/PDF-memory/production acceptance.

## B product continuation: actual features and acceptance (2026-11-03)

Parent authorized B-owned implementation while freezing C shared code. All work remains in the B worktree. Shared repair snapshot paths were SHA-256 checked unchanged (22/22), including codec, source eligibility, writer/repos/runtime and write-gate migration. No C/main/Bot writes, new dependencies, version increments, commits, pushes, merges, deployments, production migrations, paid supplier calls or cloud provisioning.

### User-visible changes and touched files

- Source subscriptions: `apps/api/src/domain/sourceCollectionActions.ts`, `sourceCollectionRead.ts`, `sourceCandidateProcessor.ts`, `apps/api/src/handler/http/collectionController.ts`, `sourceCollectionController.ts`. Expired subscriptions can renew; cancel retains the entry, delete tombstones it; current status/counts and keyset subscription lists are available. Ordinary Collection detail/owner-info dispatch reports actual source attribution. Public codes are checked against existing legacy codes and established source identity cannot silently change. Original PDF download uses current source-member authorization and returns verified stored bytes, never a storage key.
- Sync: `deploy/local/powersync-local/sync_rules.yaml`; `apps/api/test/runtime/sourceSyncAcceptance.ts` (new), `powersyncSmoke.ts`. Added on-demand `source_collections_v1`, gated by `source_collections_version=1`; legacy schema-version-2 streams remain unchanged. Separate member/article projections use authenticated subscription lookups and current publication gates. Five-minute bounded persisted expiry processing plus replication lag removes expired content; this is not an instantaneous clock predicate.
- Recommendations: `apps/api/src/domain/pgRecommendation.ts`, `dailyReading.ts`, `packages/contracts/src/daily-reading.ts`. Current legacy owner-starred and source-publication eligibility is unified; real profile/cold-start reads, bounded 20->50 topK refill, deterministic maximum-per-entity scores, bounded member/activity features and persisted failed-target diagnostics are implemented. Private and revoked rows remain excluded.
- Curation: `apps/api/src/domain/sourceCuration.ts`, `sourceIngestion.ts`, `sourceCandidateProcessor.ts`, `apps/api/src/infra/repository/dbSourceCuration.ts`, `apps/api/src/handler/http/sourceCurationHandler.ts`. Indexed operation-scoped candidates/deliveries/groups/receipts replace whole-Collection arrays and the old 1000-candidate/5000-receipt cap. Selection status is paginated; job status reads exact candidates rather than only the first group page. Existing collection JSON can normalize inside the same transaction. C publication/member/ledger effects remain atomic with B receipts.
- Daily jobs/settings: new `apps/api/src/domain/dailyReadingJobs.ts`; modified `apps/api/src/infra/recommendationRuntime.ts`, `apps/api/src/handler/http/dailyReadingController.ts`, `dailyReadingHandler.ts`, `apps/api/src/handler/cron/dailyReadingJob.ts`, contracts above. Default-disabled settings have version/timezone/revision validation. GET/refresh admit durable jobs rather than processing history; worker invocations resume bounded checkpoints with per-user leases/retries. Old immutable editions stay readable during and after refresh.
- Lifecycle/provenance: new `apps/api/src/domain/recommendationLifecycle.ts`; modified `apps/api/src/domain/search.ts`, `bookmark.ts`. Capture semantic completion delegates to shared C with honest incomplete outcomes, keeping fulltext separate. Cron consumes existing C events with bounded target/fanout checkpoints and rotates failed attempts. Source saves retain origin metadata on real user relations and preserve original PDF bytes; curation withdrawal never deletes the independent save. Full Fork and endpoint-by-endpoint lifecycle acceptance remains open.
- Schema/generation: `apps/api/prisma/pgsql.prisma`; generated `apps/api/prisma/pg_migrations/20261102153945_recommendation_business_jobs/migration.sql`; new `apps/api/test/runtime/recommendationMigration.ts`. Six B-only tables were generated with standard gen:diff, reviewed as additive, then locally applied/generated. Historical migrations are unchanged. Registration/DI/Worker/Prisma artifacts were regenerated through gen:all.
- Tests/tooling: extended `apps/api/test/infra/recommendationIntegrated.test.ts`, `apps/api/test/domain/recommendationRepairConsumption.test.ts`, `apps/api/test/runtime/recommendationSmoke.ts`, `recommendationWorker.ts`. `apps/api/script/deploy/dev-local.ts` fixes the observed macOS short socket-directory issue. Existing design/tasks/validation updated; no new unsolicited report document.

### Real PostgreSQL product scenarios

`SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationMigration.ts --test` passes **10 integrated scenarios** on owned PostgreSQL 17 with real shared C classes. External provider/index transports only are offline. The harness applies all **63 historical migrations**, runs standard local migration/gen, executes tests and removes its container.

1. Existing candidate/quality-selection/publication/Collection/user/daily/save-subscribe/withdrawal and forced receipt/member/ledger rollback remain passing after normalized storage.
2. Full 103-resource history, star/unstar/archive/delete and SQL recomputation remain correct. Added actual long-history daily job test: concurrent duplicate enqueue returns one job; two concurrent claims process only one; a one-page budget persists progress; a new coordinator resumes; one immutable edition is committed.
3. C exact-empty removal and nonzero-weight cancellation safety remain passing, with the frozen shared implementation.
4. Missing ordinary body/PDF sidecar remains unpublishable and dependency ack remains false/pending.
5. A Collection containing **1102 candidates and 5100 receipts** accepts additional staging and enumerates all candidates in <=100-row pages without duplicates. Two Collections from one publisher remain independent; source cancel/delete/renew/expiry/closed-state behavior is verified.
6. Legacy public owner-starred Collection cards and articles are admitted; own Collection, sharing-policy revocation and private resource states are excluded. Cold start is explicitly nonpersonalized.
7. Default-disabled settings, revision conflicts, interrupted job recovery, refresh operation replay and old-edition access pass.
8. More than ten actual shared text fragments are removed by recorded IDs; deleted-account profile state/contributions are removed; stale article retry cannot recreate current state. The initial assertion incorrectly expected a deleted current manifest; corrected to C's actual current=false/tombstone contract, with exact vector readback and contribution checks.
9. Real C query validation with two/seven offline index targets yields the same entity output; repeated fragment hits do not add score; twenty filtered saved hits trigger topK 50 refill; a failed target remains visible in diagnostics and shortages.

### Real Worker HTTP and scheduler evidence

`SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationSmoke.ts` passes real Workerd generated routes, PG17, R2, D1 and C writer. Only Jina/index transports are offline. In addition to the prior processing/publication chain:

- `/v1/daily-reading` initially returns disabled. Settings POST enables it with a timezone; stale expected_revision returns 409. Missing edition GET returns 202 with a stable persisted operation identity. Explicit test-only scheduler execution invokes the actual production coordinator, not fixture business logic.
- Bounded job runs publish ready mixed editions. Refresh replay retains one operation/version; old edition_id remains readable. Subscribed Collection cards disappear without suppressing unsaved source articles.
- Ordinary subscribed_list?kind=source and Collection details use real source rows. Unsaved source content produces an empty authenticated private-search HTTP result.
- Published original PDF bytes exactly equal the uploaded PDF buffer. Duplicate source PDF saves create one type=2 user relation with source_origin metadata. Withdrawal makes original download return 404 but leaves that independent user save intact.
- Actual cron schedules exactly one initial job across repeated invocations for an enabled second user and no job for an unset/disabled third user.

### Actual PowerSync evidence, not SQL simulation

`SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/powersyncSmoke.ts` starts only owned local PostgreSQL + PowerSync v1.26.1 services and uses signed fixture JWTs against real `/sync/stream`. It verifies visible explicit X membership but not Y from the same publisher, no staging member, no foreign-user rows, no source rows for legacy capability, removal after closure/withdrawal, and removal after finite expiry is materialized by the real B expiry method. Only metadata and IDs are projected; no private storage keys. The harness tears down all owned compose services/volumes. Initial compiler failure (columns selected from both member and article tables) was corrected with two authorized single-table projections; a missing fixture published_at was fixed before the final passing run.

### Standard verification and review

- gen:diff -> reviewed migration -> migration:local:pgsql -> gen:all passed in isolated owned PG; final clean replay includes all 63 migrations. No shared/old SQL rewritten.
- Final standard lint/typecheck/tests/four Worker dry-run builds pass: **0 errors/345 warnings; 223 files passed/16 skipped; 2833 tests passed/124 skipped**. The ten PG scenarios above are separately executed; other skips are not claimed verified. Focused curation/consumer/handler/sync rules: 34 passed. Existing launcher/ingestion unit tests: 15 passed.
- `pnpm api -- test:integration:local` passes all declared migration, collection, tag/lab, payment and account revocation stages.
- `pnpm api -- test:http` initially failed with local Edge/Core Network connection lost (three runs, no assertion bypass). Inspection found the standard launcher overwrote the short TMPDIR with a worktree-length path. Fixed launcher-owned short IPC directory creation/cleanup; unchanged standard HTTP then passed authentication, machine dry-run, source missing-config rejection, bookmark CRUD/D1/fulltext and diagnostic privacy checks.
- Bugs review corrected expired source resubscribe, cancel/delete distinction, group status pagination hiding job candidates, cursor collation mismatch and failed-event starvation. Security review preserves source/publication/user gates, distinct private-search admission, no invented owners, no provider calls or secret loading. Compliance preserves frozen C sources, additive-only B migration and independent client/production gates. Remaining scope is classified below rather than silently waived.

### Completion and exact remaining work

**36/53 complete, 17 remain; 12 newly completed tasks: 1.2, 1.3, 4.1, 7.1, 7.3, 7.11, 8.1, 8.2, 8.3, 9.1, 9.3, 10.3.** Existing curation tasks now have scale evidence instead of an unresolved capacity cap. Final actual PG rerun passes **10 scenarios**: the tenth publishes independent winners in two source Collections with identical external/group identifiers, checks distinct aggregates/member pages, denies a foreign member reference, closes a Collection inside the index response before hydration, rejects its stale public-looking hit and preserves an independent user save after withdrawal.

- **Still implementation/acceptance, not blocked on C:** complete source notification recipient/delivery policy and all ordinary detail-contract coverage (7.2); complete ingestion per-item retry diagnostics/consumer automation (7.7); full source-to-private Fork snapshot/provenance path (8.4); all REST/sync/Fork/recapture/media/account-deletion fault-injection paths plus late-visible lower-ID event and sustained fanout stress (5.1/5.2/6.1-6.5). Added lifecycle orchestration and exact cleanup fixtures are not blanket completion of those matrices.
- **Shared/environment acceptance:** representative large/scanned PDF peak memory and real provider mapping remain incomplete (3.4/10.4); no new C algorithm defect is claimed by this pass and frozen sources were not changed.
- **Waiting on explicit human/operator authorization:** paid samples (10.4), selected client UX and human hands-on acceptance (10.6), CLI/Extension/Mobile version decision for shared-contract impact (10.7), production recipe/bindings/capacity/cutoff and release/rollback (10.8), merge then archive (10.9). No such action was taken.
- **Final review gate (10.5):** local Bugs/Security/Compliance review and strict validation evidence are recorded, but complete full-feature release acceptance is not claimed while the listed product tasks remain open.

Final audit at the previous checkpoint: strict OpenSpec 94/94, diff checks and 22 frozen shared hashes passed; progress was 36/53. The following recovered-slice evidence supersedes its implementation totals.

## Automatic processing, independent source saves and mutation acceptance

### Recovery and safety

After the parent reported the background 7200-second timeout, recovery inspected git status, task/validation files, completed command logs, active background tasks and B-associated containers/processes. Prior source/private-copy code, schema and generated migration had landed. No migration/write/install was blindly replayed, no reset occurred, and no B test process/container remained active. Last completed shared-hash audit was confirmed; all 22 shared snapshot files remain unchanged. C's newer backfill domain/script hashes supplied by the parent were not imported. Branch/HEAD remain feat/vector-v5-recommendation/cfd51f55.

### Implemented files and behavior

- New `apps/api/src/domain/sourceProcessing.ts`, `apps/api/src/handler/cron/sourceProcessingJob.ts`: automatic bounded discovery of accepted batches and nonready candidates, durable token claims, next_retry, bounded 429/5xx retries, terminal permanent/exhausted outcomes and abandoned-lease recovery. No manual dispatch is required. Work never performs review, winner selection or publication. Current operator source scope is rechecked through `apps/api/src/middleware/sourceIngestionAuth.ts`; background scope cannot gain review/publication rights.
- `apps/api/src/domain/sourceIngestion.ts`, `sourceCandidateProcessor.ts`, `sourceCuration.ts`, `apps/api/src/infra/repository/dbSourceIngestion.ts`, `dbSourceCuration.ts`: typed per-work diagnostics; candidate processing accepts candidate-write scope but review remains publication-scoped. Actual candidate result commits fence stale processing tokens in the same transaction and preserve current human review.
- New `apps/api/src/domain/sourceSavedCopy.ts`, `apps/api/src/utils/sourceSnapshot.ts`, `apps/api/src/handler/http/sourceSavedController.ts`; modified `apps/api/src/domain/bookmark.ts`, `domain/orchestrator/bookmark.ts`, `domain/sourceAssetCapture.ts`, `domain/pgRecommendation.ts`, `domain/userDeletion.ts`, `apps/api/src/handler/http/bookmarkController.ts`: native SnapshotBundle/Fork privatization/PDF mechanics create independent private body/text/images/PDF, real user relation identity and canonical/direct provenance. Current source/member revision and matching manifest are recorded; destination permissions are rechecked on reads. Source withdrawal does not delete completed private resources. Native Lab gates remain. Saved canonical sources are excluded through the actual private-copy relation. Ordinary and account deletion clean destination images and B user metadata.
- `apps/api/src/handler/http/collectionController.ts`, `packages/contracts/src/collections.ts`: ordinary detail accepts discriminated source member IDs; source page/count/status/attribution types are additive and legacy cb_id paths remain unchanged. Notifications stay disabled as explicitly directed, without owner fabrication or new delivery channels.
- `packages/contracts/src/bookmarks.ts`, `ingestion.ts`: additive source-private result/provenance and automatic work diagnostics. `apps/api/src/infra/recommendationRuntime.ts` reuses the existing scoped Prisma client. `apps/api/script/gen-routers.ts` registers the private-copy controller; DI/router/cron/Env/Prisma outputs were generated through standard tools.
- `apps/api/prisma/pgsql.prisma` and generated `apps/api/prisma/pg_migrations/20261102172720_source_processing_private_copy/migration.sql`: two B-only tables, no existing table alteration or C DDL changes. Migration SHA-256 `0869afa074eaf3b29afc5d224969523383a7eb073ed2b554979eb26505d1e1dd`.
- Tests: new `apps/api/test/domain/sourceAutomation.test.ts`; extended `test/infra/recommendationIntegrated.test.ts`, `test/runtime/recommendationSmoke.ts`, `recommendationWorker.ts`, `recommendationMigration.ts`, `test/domain/recommendationRepairConsumption.test.ts`, `test/script/generatorPaths.test.ts`, `test/di/cronjob.test.ts`. `test/runtime/httpSmoke.ts` adds actual authenticated Core readiness and per-run service names; no existing business assertion was removed. Existing design/tasks/validation were updated.

### Actual automatic processing and private save evidence

`SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationSmoke.ts` passes against actual generated Workerd HTTP routes, PostgreSQL 17, R2/D1/KV and C writer. Test-only clock ticks invoke the production SourceProcessingJob; only embedding/index external transports are substituted.

- Accepted batch is persisted before any work row exists; cron discovers and stages it, and a later tick captures/embeds without `/dispatch` or `/process`. Duplicate admission returns one job. Ready vector status still reports review=pending/publication=staged and no member is published.
- Provider 429 and 503 produce retry metadata/next_retry; an abandoned processing lease is reclaimed. A mixed batch returns partial with a permanent asset failure and successful candidate. Missing required body is terminal; repeated provider failure exhausts the explicit retry budget. No failed/low-quality candidate is auto-published.
- Existing add_url returns a real private relation UUID, content ready and honest vector pending. Duplicate returns one save. HTML/text, a selected Reader-owned image and PDF original have independent storage pointers. Matching C source manifest and canonical/direct revision provenance are retained without a fabricated source bookmark UUID.
- Private body/image reads remain identical after source withdrawal. A different user cannot read the private copy or create a new copy from the withdrawn member. PDF copy bytes match the uploaded original; source download becomes 404 on withdrawal while private PDF remains readable. Native PDF Lab permission is explicitly enabled for the fixture rather than bypassed.
- Native REST repeated star and actual `/v1/sync/changes` unstar/archive/trash/restore execute through real services. Private content is denied while trashed and readable after restore. Ordinary source subscribe/status/list/detail/count/publisher routes pass and do not invent owner or bookmark UUID fields.
- Recovery added final actual UserDeletionService cleanup: copied HTML/PDF/image objects are removed, source-copy/daily user metadata disappears, and canonical public source records remain. This was verified after the final cleanup code landed.

### Mutation evidence matrix

| Surface | Actual evidence | Remaining coverage |
| --- | --- | --- |
| REST saves/stars | Worker add_url private-copy/replay; real BookmarkRepo create/repeated star; one relation | Broader simultaneous unrelated save load |
| Local-first mutations | Actual generated HTTP PATCH star/archive/trash/restore and DBSyncBatchOperation PostgreSQL transactions | Every client transport and sustained upload load |
| Lost enqueue/hints | Real sync commit observer throws; durable C events remain and later reconcile | Long-running queue outage/backlog pressure |
| Late commit ordering | Lower-ID star transaction held open while higher real star transitions commit/ack; lower event then appears and reconciles | Sustained concurrent transaction stress |
| Weight correctness | Saved/starred weights derived from authoritative sr_user_bookmark/sr_user/sr_bookmark and frozen policy, compared to 1024 raw sums; not only contribution self-consistency | Broader heterogeneous numerical fixtures |
| Import | Native createBookmarkRelation importMetadata path preserves starred/saved state | Full file-import Workflow retry/failure end-to-end |
| Body replacement/recapture | Native BookmarkRepo.updateBookmark changes source revision; applied representation ID changes and sums reconverge | Complete recapture Workflow HTTP/failure matrix |
| Source private Fork/save | Native snapshot/Fork privatization helpers; actual original HTML/images/PDF and withdrawal/foreign checks | Further user-to-user Fork of a source-derived copy and all existing workflow failure modes |
| Collection/subscription | Real owner-starred and explicit source aggregates, own-Collection suppression, no per-member saves, source cancel/delete/renew, legacy finite expiry | Sustained dependent fanout and revised-vector concurrency |
| Last-read only | Native CollectionRepo.updateSubscriberLastReadAt produces no new vector change | Client-specific upload acceptance remains broader scope |
| Deletion | Actual shared >10 fragment removal, stale retry and account-profile removal; native account cleanup removes B metadata/assets | Full concurrent permanent-delete and late Workflow matrix |
| Media/PDF | Actual original PDF processing/copy and existing media unit suites | Real media recovery Workflow and representative large/scanned PDF memory (C-owned acceptance) |

`recommendationMigration.ts --test` passes **12 actual PG scenarios**, including this matrix and stale B worker lease/newer-review tests. Its standard migration/gen process replays **64 migrations** and cleans the owned container. An initial late-event fixture incorrectly used archive-only mutation (correctly neutral/no event); changed to real star/unstar transitions, then passed. No C trigger or algorithm was altered.

### Stage-end checks and failures

- Standard gen:diff -> reviewed SQL -> migration:local:pgsql -> gen:all succeeded on owned local PostgreSQL; no historical SQL was edited.
- Final lint/typecheck/full tests/four Worker dry-run build pass: **224 files passed/16 skipped; 2836 tests passed/126 skipped; 0 lint errors/345 warnings**. Twelve PG tests were separately executed; other skips remain unverified. Recovery focused suite: 15 passed; full actual product HTTP including account cleanup passed.
- Standard `test:integration:local` passes all declared migration/collection/tag/lab/payment/account stages. Standard `test:http` ultimately passed on its final run. Intermediate attempts failed with local native workerd/service-binding connection loss, including an explicit runtime crash; no fake HTTP pass or assertion bypass was introduced. The short IPC launcher fix remains; actual Core readiness and per-run service names improve harness isolation but are not claimed to prove the sole cause of every transient failure.
- Initial generator/cron inventory assertions were updated for the new legitimate controller/job, optional lease-call assertion was updated, a missing harness KV binding for native sync cache invalidation was added, and permanent-vs-transient error fixtures were corrected before final passing runs.

### Three-pass local review (REVIEW.md)

- **Bugs / Important, resolved:** automatic writes could outlive their B lease; fenced inside the candidate transaction and actual expired-token regression passes. Background result replay could overwrite a newer explicit review; preserve current review and test rejected state. Existing-copy publication could overwrite a concurrent successful private destination; reject it. Saved vector-ready now checks current source revision/digest/deletion/cleanup. Source HTML now retains the native managed snapshot marker. Missing generated route registration was fixed at generator source.
- **Security / Important, resolved:** native PDF Lab gate is reused; new viewer copies require current publication and user authorization, copied assets use owner-only routes and post-read ownership checks, presented provenance omits storage keys, private assets/B metadata are cleaned on account removal. Background credentials are revalidated and never grant review/publication scope. No supplier credentials, secret files or unexpected external delivery paths were introduced.
- **Compliance:** change remains vector-v5-recommendation, additive B schema only, 22 shared paths frozen, old index routes/default activation untouched, notifications remain disabled, no client UI/new dependency/version/release action. Remaining matrices and environmental/human gates are explicitly open rather than silently waived. No unresolved Important finding is asserted within the exercised slice; this is not full-feature production acceptance.

### Parent handoff / remaining work

Progress is **42/53**, 11 open: this slice completes **6.1, 6.2, 7.2, 7.7, 8.4, 10.5**. Local unfinished tasks are **5.1, 5.2, 6.3, 6.4, 6.5** for the remaining matrix cells above, not a generic C dependency. **3.4** remains representative PDF memory/coverage acceptance coordinated with C. **10.4/10.6/10.7/10.8/10.9** remain supplier/payment authorization, client UI acceptance, version decisions, production recipe/binding/cutoff/release approval and post-merge archive. Existing notification disabled policy is complete; enabling a channel/recipient later requires a separate product decision.

Return the minimal tooling fix to C through the parent, not by writing C: `apps/api/script/deploy/dev-local.ts` main() only creates a short owned IPC directory, passes TMPDIR to the child and removes it in finally. HEAD-before SHA-256 `4fe431c6bef45a9800b2a44f50a885d40953b306ef8ba3ba9a26e63b012d6632` -> B SHA-256 `41c9a93a5a9a48b52693a476b546c27aa0f031faef7f08477b2fe03aaf0a99cd`. Optional test-only `apps/api/test/runtime/httpSmoke.ts` per-run service/readiness changes have B SHA-256 `85b4f639e5a5022f294f779b6575fa765a83d43700193e07384b8f4400397641`; merge only these tooling hunks, not B business assertions wholesale. No shared C source import/update is included.

## Finite lifecycle and fanout slice — 2026-11-03

### Result and boundary

Tasks **5.1, 5.2, 6.3, 6.4 and 6.5** now have bounded local acceptance. The current standard HTTP attempt failed, so **10.3 is reopened** rather than preserving a misleading green gate: current total is **46/53**, seven open. Prior 42/53 and passing standard HTTP records above remain historical. No production, deployment, cloud provisioning, paid provider call, version change, commit, push or C worktree update was authorized or performed in this slice. Branch/HEAD remain feat/vector-v5-recommendation/cfd51f552327edfc9d23dc00e4b1d088ec955fb3. All 22 shared-repair-snapshot.json hashes (including merged overrides) were rechecked: zero mismatches.

### Real runtime scenarios

- **5.1 / import and retry:** lifecycleSmoke imports an actual two-record Omnivore JSON file through ImportService, actual local queue delivery and native CrawlWorkflow. One record follows normal capture; the other receives one offline Jina 503 before recovery. R2 markers assert that failure and recovery both occurred, both imported relations reach success, both recipes produce four current ready article manifests, and each bookmark has actual D1 fulltext rows. No business writer or queue/workflow orchestration is replaced.
- **5.1 / recapture and recovery:** native ImportParseWorkflow commits a revised body while the provider fails; old manifest identity remains but is not current for the new source revision. Restoring transport lets Workflow retry converge. The exact save relation's contribution representation changes and authoritative two-save weight stays two. Native MediaSnapshotService settle/index rejects a missing artifact before changing revision, then publishes a restored article; repetition does not add weight. Native capturePdf on revised original bytes refreshes extraction; failed indexing stays noncurrent and recovered indexing replaces the exact contribution without duplication. These are bounded native recovery-boundary tests, not paid transcription/media-provider acceptance.
- **5.1 / source-derived user Fork:** native source save gives user 1 independent HTML/image and PDF resources; native BookmarkForkService admission and Workflow create user 2 copies. Destination keys differ; base64 comparisons equal the original image and PDF bytes exactly. Canonical article provenance survives, direct_source points to the actual user 1 bookmark UUID, and forked_from_id is the true relation ID. Source closure plus user 1 sharing revocation denies a real third user new Fork admission while existing copies remain.
- **5.2 / deterministic deletion:** a test-only external-fetch barrier blocks a native recapture before publication. Permanent bookmark deletion and native UserDeletionService cleanup commit before release. After late Workflow settlement and bounded existing-ledger drain, private resource/profile/contribution/current manifests and owner objects remain absent; user 2 copies and canonical source records remain. This supplements prior actual >10-fragment cleanup/stale retry evidence, not a claim of unbounded race/load coverage.
- **6.3–6.5 / bounded fanout:** a real PostgreSQL case creates twelve subscribers to both a legacy owner-starred and an explicit published source Collection. Actual database triggers produce the events; C admitOutstanding discovers them without manual fanout enqueue. A new RecommendationLifecycle instance on every process call resumes persisted user cursors past the ten-user page. The legacy body changes to an orthogonal fixture embedding, then the owner unstars, then source curation withdraws its member. All twelve users' raw vectors and weights match current authoritative member policy at 1e-8, and no subscriber obtains a personal save. Acknowledgement occurs only after complete processing. Earlier own-Collection suppression, expiry/cancel/delete/renew, lost post-commit observer, duplicate replay, late lower-ID transaction and last-read-only neutrality evidence remains in the preceding matrix; it was not replaced with contribution self-consistency alone.

### Production corrections and fixture scope

1. UrlParserHandler previously swallowed semantic-index failure and detached callbacks even in the v5 path. When DAILY_READING_ENABLED or VECTOR_V5_SEARCH_ENABLED is true, it now propagates the settled search callback failure to native Workflow retry; flags-off behavior is preserved.
2. SearchService semantic completion resumes at most eight shared preparation_pending pages. Other waits/failures throw immediately and exhausted preparation remains pending. C still owns reconcile/verify, manifests, modality coverage, arithmetic and exact cleanup.
3. SnapshotBundle copies source-derived private images into the destination bundle, validates the image prefix against the actual source HTML UUID, rewrites private references and retains native publication bookkeeping. Forged foreign-prefix rejection has a focused regression test. Fork publication persists canonical/direct provenance after existing metadata triggers; the additive contract permits direct_source kind user_bookmark as well as source_member.
4. The new lifecycleTransport/lifecycleWorker/lifecycleSmoke/lifecycleCases harness uses real local PG17, all 64 main migrations, logs/D1 migrations, R2/KV, SlaxJieba Durable Object, queues and native workflows. Only external website/Zyte/moderation/Jina and index RPC transports are offline; unknown external destinations fail closed. Fixture keys are literal offline values, not secrets. Finite controls/barriers exist only in the unregistered test worker and require its per-run random bearer token.

Intermediate failed attempts are not counted as acceptance: the initial oversized 202-row duplicate-import fixture exhausted local connections and was replaced with the required finite two-record file; initial harness configuration lacked the real SlaxJieba binding/moderation response and had an incorrect relative tsconfig; transport import ordering and Uint8Array/base64 handling were corrected. An early unsupported external fallback returned 401 without credentials, before unknown-destination fail-closed handling; no paid provider acceptance is claimed. The substantive live failures were swallowed posthandler errors and insufficient shared preparation continuation, fixed in production code rather than suppressing assertions. A contract formatter initially selected default style, then was rerun with the existing API .prettierrc.mjs; there is no intentional style-wide contract rewrite.

### Current commands and results

All commands ran from /Users/daguang/project/slax-reader-vector-v5; API commands used SLAX_API_SKIP_DOTENV=1.

| Command | Current result |
| --- | --- |
| pnpm api -- test test/utils/snapshotBundle.test.ts test/domain/bookmarkFork.test.ts test/domain/mediaSnapshot.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts | 138 tests, 4 files passed; 4.269 s command wall time |
| pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/recommendationMigration.ts --test --finite-fanout | Standard migrate/local consistency/gen:all succeeded; 1 new actual-PG case passed, 12 older cases deliberately name-filtered; case 20.203 s, command 56.822 s |
| pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/lifecycleSmoke.ts | All six runtime result stages passed, including retry/D1/binary assertions; 122.088 s |
| pnpm api -- lint | Exit 0; 0 errors, 345 warnings |
| pnpm api -- typecheck | Exit 0; contracts and backend |
| pnpm api -- test | 224 files passed / 16 skipped; 2837 tests passed / 127 skipped; 74.414 s command wall time |
| pnpm api -- build | Exit 0; four offline Worker dry-run bundles; no deployment |
| pnpm api -- test:http | **Exit 1**, one attempt only; 38.602 s. See failure below. |
| pnpm api -- test:integration:local | Exit 0; collection pagination, tags, Labs, triggers, telemetry, payment and account revocation stages all passed (45 assertions across 8 suites) |
| pnpm exec openspec validate --all --strict | 94 passed, 0 failed |

The 127 default-suite skips are not a blanket pass. The new actual-PG fanout was separately executed; twelve older PG acceptance cases were deliberately not rerun under --finite-fanout. Prior dedicated product Worker/PowerSync evidence remains historical, not a fresh execution claim.

Persistent command logs share this prefix: `/Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-369/tasks/`. Focused tests: `bash-yjj1o8x2/output.log`; lifecycle: `bash-f74332r9/output.log`; full tests: `bash-azog5l9f/output.log`; single failed standard HTTP: `bash-z75ufs11/output.log`. Successful finite-fanout, lint, typecheck, build, local integration and strict validation output are retained in the same agent's event log.

**HTTP failure:** main/logs/D1 migrations, authenticated readiness, machine dry-run idempotence, exact CORS, auth/spoofing denial, storage-unavailable responses and route-suffix denial passed. The next authenticated `list-before` request at httpSmoke.ts:321 failed JSON decoding at line 89 with `SyntaxError: Unexpected token 'E', "Error: Net"... is not valid JSON`. The cleanup tail also contains esbuild service-no-longer-running/exit-143 messages; those do not establish the root cause. The owned PG container was removed. No business assertion was removed, no retry-until-green was run, and no new launcher architecture was attempted. Parent/C owns unified follow-up; this gate remains red.

### REVIEW.md passes

- **Bugs:** reviewed native callback ordering, flags-off behavior, bounded preparation progress, exact relation/revision assertions, duplicate weight neutrality, member direction replacement, persisted cursors and late deletion. Actual runtime tests exposed and verified the callback/continuation corrections. Non-PDF publication's immediate internal relation object does not carry the post-trigger source metadata refresh; current return and afterCommit consumers only use identity/bookmark data and later reads reload DB, so no user-visible stale metadata regression was found. No speculative refactor was added.
- **Security:** image ownership is checked against the actual source snapshot, not arbitrary HTML-supplied prefixes; foreign-prefix regression passes. Native sharing/claim/publish checks remain, test controls are isolated/authenticated, and no new dependency/credential reader/production endpoint was introduced. Independent artifacts survive source revocation but not their own owner's deletion.
- **Compliance:** linked change is vector-v5-recommendation; only the five finite tasks close. No shared DDL/writer algorithm or new platform is introduced. Current HTTP failure explicitly reopens 10.3; 3.4, 10.4 and 10.6–10.9 remain open. This is local partial delivery, not a fully verified release.

### Exact files changed in this finite slice

Production files and SHA-256:

```text
a2d55a4338f0b901f5b6d5bdc76246be2f3e59de57c39ed057d554fbeac813ea  apps/api/src/domain/orchestrator/urlParser.ts
40d22c2b2cadbfad7ccad0547253e31ccbcb224275397f0d2509543b3d879d6f  apps/api/src/domain/search.ts
ca0cdec6df903fc2b399bd1bd0b3bad2d4d233cc4f388269155476c1fb379d96  apps/api/src/utils/snapshotBundle.ts
872df66b34206e04e18313cf304200ee97432a93b1ff823fa5d9507dc8d68bbe  apps/api/src/utils/sourceSnapshot.ts
8102e6f2adab4a8f529dfc66c5e6ee42560fddfe0b9b4297c768fcfb0a970767  apps/api/src/domain/bookmarkFork.ts
a0836d79212e6332ad45c392ec0f718fbc3a9e80f2bda296c2feb692f635622a  apps/api/src/infra/repository/dbBookmarkFork.ts
a6d2aac1f804353bb3688b92702c961c4b614c569235461d09aba97767cdf212  packages/contracts/src/bookmarks.ts
```

Test files and SHA-256 (the four lifecycle files are new):

```text
98dea6a0049f02549732dd1d3a24f980853bfea659103644267f465c0d8db871  apps/api/test/runtime/lifecycleTransport.ts
49139d6bd2f92d46adb06014a7d4c8dc3cb8b0f41f427234a7f9fa174c80cb12  apps/api/test/runtime/lifecycleWorker.ts
36bd466c8e22a3ba13c46b8c609b0ccf05bc7952d925923344a97aace3b833d2  apps/api/test/runtime/lifecycleSmoke.ts
e61793a879f6381ee3a8de215b603e6e2b6962fc113ea2eef736ebecb796b4ba  apps/api/test/runtime/lifecycleCases.ts
c1602db9979bdc072607270182ed8f724c1805f4f7e676a3f0bd6cb3cc1a49e7  apps/api/test/runtime/recommendationMigration.ts
36c07420f3a6c480a12ab209a458f4d04a2c4d3ed6ed6cb64130b421fedddb17  apps/api/test/infra/recommendationIntegrated.test.ts
d988708898aea84969e01dfb008cb80515c1662545d067790d889c4af6e064e5  apps/api/test/utils/snapshotBundle.test.ts
```

Documentation: this validation.md, sibling design.md and tasks.md. Standard gen:all rewrote its normal DI/router/consumer/cron/Worker type outputs; no new registration was added in this slice and no generated file was hand-edited. Existing dev-local.ts and httpSmoke.ts hashes still equal the preceding handoff; they were not redesigned or changed here.

### Remaining handoff

- **3.4:** parent integrates only C's reviewed representative PDF segmentation/memory/coverage proof and exact files; do not copy the active C worktree or call this tiny PDF fixture representative.
- **10.3:** resolve the standard HTTP Error: Net failure through the unified parent/C tooling effort and rerun the unchanged standard scenario. Do not infer a causal fix from an occasional pass.
- **10.4:** explicit paid-vendor authorization and actual text/image/scanned/oversized PDF request/output mapping.
- **10.6/10.7:** parent obtains client scope/hands-on acceptance and explicit affected CLI/Extension/Mobile version decisions; no version was silently incremented.
- **10.8/10.9:** verified generation/binding fingerprint, counts/coverage/cutoff/lag and release/rollback authorization, followed by post-merge archive classification. No deployment or archive here.

B continues to consume the frozen public reconcile/verify/contribution/publication and outstanding/checkpoint/boolean-ack contract. No additional shared writer algorithm is requested from C. This handoff is intentionally prompt and bounded, with the HTTP failure retained rather than hidden by repeated attempts.

Final integrity/resource checks: git diff --check passed; tasks are exactly 46 checked and 7 unchecked. TaskList reports zero active background tasks. Process inspection found no runtime test process scoped to the B worktree; all four newly owned fanout/lifecycle/HTTP/integration container IDs are absent from docker ps -a. Other agents' resources were not stopped. No commit, push, merge, reset, production migration or deployment occurred.

## Independent maintenance activation slice — 2026-11-03

### Current authorization and truthful result

The parent relayed the human's new explicit local apply instruction: maintain article content vectors, Collection content vectors, saved-article preferences and subscribed-Collection preferences only. The user preferences must be separate, not an alpha/beta mixed vector. Daily reading, ranking/UI, curation improvements, new notifications and Bot collection products are deferred, retained and disabled. The original tasks remain historical; current maintenance acceptance is M.1-M.6. M.1 and M.2 are verified. M.3-M.6 remain open. No model effort parameter was available or claimed configured.

This is a stable B-owned integration slice, not completion of independent shared storage. The integrated C entitySchema still permits only an untyped user_preference target. B's new adapter requires preferenceKind article or collection and rejects that legacy contract with independent_preference_contract_unavailable before a user read/write. No C core source, migration, backfill or active worktree file was copied or modified. A single read of C's existing design was used; the parent must integrate C's stable split patch and align its exact public discriminator.

### Implementation and interface

- VECTOR_V5_MAINTENANCE_ENABLED is optional and defaults false in the public configuration. VectorMaintenanceJob runs every five minutes, expires at most 1000 source plus 1000 legacy subscriptions and drains at most ten durable lifecycle events. DailyReadingJob no longer owns expiry/lifecycle drain. Existing daily and source processing gates remain independent.
- SearchService's native completion uses v5 when maintenance is enabled; with v5 search disabled it also runs the existing legacy embedding/index branch and waits for both outcomes. V5 preparation is bounded at eight continuations. UrlParserHandler propagates maintenance failure to native Workflow retry. Existing query generation is not switched.
- Successful REST and local-first hooks accelerate two events through RecommendationLifecycle and the existing C ledger, rather than creating another log. Article/Collection dependencies precede independent user work. Subscription events request only the Collection preference; account cleanup requests both typed targets. Source subscription writes remain committed and report profile_pending if maintenance is unavailable. No per-subscriber Collection vector or member-save amplification was introduced.
- Existing source-aware normal Collection and save/read routes can operate with maintenance enabled and daily disabled; original permissions, source publication checks, native PDF Lab gate and independent private-copy logic remain. This does not enable machine ingestion, source curation publication, daily ranking or notifications.
- SharedRecommendationMaintenance.preference(userId, kind, pageBudget) scans only saves or only subscriptions, reuses the existing applied-removal and publish pipeline, and delegates all arithmetic/normalization to C. userPreferences returns both independent outcomes. The old product path remains preserved when maintenance is disabled; it is not used as fallback by the new maintenance path.
- readUserPreferences(ctx) returns { article, collection }, each with preferenceKind, snapshot, revision and origin (bucket/committed/cold-start). Exact-user and generation/recipe/revision checks reuse existing read validation. An unlabelled mixed snapshot or wrong-kind projection is an explicit error. Missing one preference never copies the other. This is an internal entrypoint only, not a new public recommendation endpoint.

### Actual local evidence

The reused lifecycleSmoke.ts --maintenance-only mode runs genuine Workerd, PG17, R2, D1, KV, queue and native CrawlWorkflow. Only external website/moderation/embedding/index transports are offline. All 65 migrations replay unchanged on owned databases. The final run passed in 43.498 seconds; an earlier pre-final run also passed in 75.796 seconds.

- Actual two-record file import, one injected v5 503/recovery, native queue and workflow completion, four current v5 article manifests and D1 fulltext rows pass with DAILY_READING_ENABLED=false, VECTOR_V5_SEARCH_ENABLED=false, SOURCE_INGESTION_ENABLED=false and maintenance=true. Fixture receipts separately prove jina-clip-v2 legacy requests/writes and jina-embeddings-v5-omni-small v5 requests.
- Actual native indexing of a substantive stored image and an original PDF passes both recipes and requires nonzero ready image/PDF coverage. These are small binary fixtures, not representative 50 MiB/large shared-resource memory acceptance.
- Native BookmarkRepo star/unstar and DBSyncBatchOperation trash/restore produce real ledger events. Collection accumulation and clearing match a full authoritative eligible-member SQL count and all 1024 raw components at 1e-8, not the contribution rows themselves.
- Actual source subscribe/cancel/renew commits remain durable. Independent cron expires source and legacy subscriptions and captures their changes; no daily or source-processing jobs are created.
- The real user-read endpoint returns the explicit legacy-contract incompatibility; no ready mixed user manifest is published. Independent user normalization, independent cancellation/replay full recomputation, real split by-ID materialization and deletion/late-job behavior are NOT proven until C is integrated. The runtime output labels this BLOCKED rather than a full pass.

Unit port tests are explicitly separate: independentLifecycle.test.ts mocks only the future kind parser and verifies subscription-only dispatch, unfinished event retention and both account-deletion targets. independentPreferences.test.ts verifies separate origin/revision/cold-start and wrong-kind/mixed rejection; it is not shared writer/DDL evidence.

### Commands and open standard HTTP failure

All commands ran in the authorized B tree with SLAX_API_SKIP_DOTENV=1 for API commands.

- Standard isolated recommendationMigration.ts -> migration consistency -> gen:all: passed; the final run reports no schema changes. Prisma/Worker types/cron/DI/routes came from generators.
- One standard full unit suite: 231 files passed, 16 skipped; 2903 tests passed, 128 skipped. This preceded the final added wrong-kind/lifecycle/route checks; final focused run of seven files passed 85 tests. Skipped DB tests are not reported as passes.
- lint: exit 0, no errors; typecheck: exit 0; all four offline Worker dry-run builds: exit 0; strict OpenSpec: 94 passed, zero failed.
- Standard test:http: exactly one attempt, exit 1 in 43.394 seconds. Migrations and authenticated readiness passed; malformed machine request returned 400; the next machine request returned outer Miniflare 500 Network connection lost instead of 200. No retry-until-green, assertion removal, launcher change or competing runtime diagnosis was made. C/parent retains the causal investigation.
- git diff --check passes. Shared core hashes match the previously integrated snapshot. All 65 recorded migration SQL hashes match; no foundation DDL was added.

Evidence logs under /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/tasks/: final actual maintenance bash-weie0ly1/output.log; earlier maintenance bash-49udb1v8/output.log; full tests bash-xpyhb8ad/output.log; single failed standard HTTP bash-3rk1kg6q/output.log; initial lint/typecheck/build/strict validation bash-nob7fxxj/output.log; final post-route-alignment lint/typecheck/build/strict validation bash-5vj1xngg/output.log (all passed). Resource inspection found no owned generation/maintenance containers and no B-worktree lifecycle/HTTP/generation test process remaining. Branch and HEAD remain feat/vector-v5-recommendation / cfd51f552327edfc9d23dc00e4b1d088ec955fb3.

### Review and handoff limitations

Bugs: checked new flag defaults, legacy write continuity, bounded retries/drain, subscription-only dispatch, persisted checkpoints, dependency order and separate cold-start. Fixed the source ordinary-route outer/inner gate mismatch and prevented wrong-kind bucket errors from being hidden by committed fallback. Security: test controls remain isolated and authenticated; no new public endpoint, secret read, network supplier, dependency or credential default. Compliance: current scope is documented, existing product code/tests are retained, C remains sole foundation owner, no product activation, deployment, paid sample, version change, commit or push. The known incomplete shared split and standard HTTP failure are open acceptance gates, not hidden successes.

Parent must obtain C's frozen shared split before enabling maintenance in a real environment, align preferenceKind naming, and exercise each independent accumulator/materialization against authoritative complete business data. Representative large PDF, real provider mapping and operator release remain open. This slice changes API-only implementation/configuration/test paths, not shared client contracts or application versions. Earlier cross-client contract version decisions remain the parent's separate gate.

### Files touched and key public/configuration hashes

Production: apps/api/script/generate-worker-types.ts; deploy/cloudflare/api.toml.example; apps/api/src/domain/{independentPreferences,userPreferenceRead,sharedRecommendationMaintenance,recommendationLifecycle,recommendationHooks,search,sourceCollectionActions,bookmark}.ts; apps/api/src/domain/orchestrator/urlParser.ts; apps/api/src/handler/cron/{vectorMaintenanceJob,dailyReadingJob}.ts; apps/api/src/handler/http/{collectionController,sourceCollectionController}.ts; apps/api/src/infra/recommendationRuntime.ts.

Tests: apps/api/test/domain/{vectorMaintenance,independentPreferences,independentLifecycle}.test.ts; apps/api/test/di/cronjob.test.ts; apps/api/test/runtime/{lifecycleSmoke,lifecycleWorker,lifecycleTransport,vectorMaintenanceCases}.ts.

Generated via gen:all: apps/api/src/di/generated/{cronjob,dependency,readerRouter,consumer}.ts and apps/api/worker-configuration.d.ts plus standard ignored Prisma/runtime outputs; readerRouter/consumer hashes stayed unchanged. Documentation: this validation.md, proposal.md, design.md, tasks.md, specs/preference-maintenance/spec.md and specs/vector-v5-runtime/spec.md in the same change.

```text
721e54fed106897b0bc97f8826b47bacf933014b75ed54bec7ff46d1f82f4edc  apps/api/script/generate-worker-types.ts
76dee6f40ddad5921f67499202388f017a6d352c0a31e96646d57e8800e452c9  deploy/cloudflare/api.toml.example
cba4457ee761efe8e485084fb2b8d38711f42da40dca5bfa5a81a495f92e53e7  apps/api/src/domain/independentPreferences.ts
0906202cd51df8f003d5307173b6d2f4a52435548b4e34f64e16d83d4a25e3e1  apps/api/src/domain/userPreferenceRead.ts
545b019300f6d24d458966bb8b50d24ba65274cb371a21f13978c0b1524a29ac  apps/api/src/domain/sharedRecommendationMaintenance.ts
36b861e38ef8bcb18cbd5f8a73ffae35235338731c2b64bf09ba4c05e99e23f1  apps/api/src/domain/recommendationLifecycle.ts
b2c664e8b1a64dd3509f26f8ebfffc114fa26d2fddef2f468853b5dbc15562ee  apps/api/src/domain/recommendationHooks.ts
f0c53f17e7d060f1f1ac10e2e163ed93af10ea849d8bb7ffdf10e56a80838aa4  apps/api/src/domain/search.ts
32947b7629b64637eba5e82d5c2d11e915a68d4cc8a37f90679d4308d959a729  apps/api/src/domain/orchestrator/urlParser.ts
50140296146d40053ad67f8bee80292063d55c42cd05f6b5021d43a79dd723fc  apps/api/src/domain/sourceCollectionActions.ts
662f32c0521133473ce9a069df3d059417a19788e0149ee71a67006b14d5b0b5  apps/api/src/domain/bookmark.ts
28df8d252550273225ddd7c456becf6aea3134d5e17deeb2b46c9009df884001  apps/api/src/handler/cron/vectorMaintenanceJob.ts
52cb6663c16e20bb9630c044f128c6add9dc7e7f56659ef870f7d768daa6425f  apps/api/src/handler/cron/dailyReadingJob.ts
21687b1e85c6c7ac196e991c2d83a28f2b1c016d872c38c0d2321b850542d426  apps/api/src/handler/http/collectionController.ts
e35b849128fdeb6f0aca4d196f5c3538e6aa5420d3738870beed95431811ad02  apps/api/src/handler/http/sourceCollectionController.ts
498777b7494368f03d30ecca1b3ebef4bdb1df572ea7b51cbc457657a74e7303  apps/api/src/infra/recommendationRuntime.ts
edde1bd6693a2b16a6204ba5e745a565093d22729ee83ab4e7a0fb5d2ffaffa2  apps/api/src/di/generated/cronjob.ts
b080609eb2dca06aa876b13b24d11d9deeee4e7aa6653f17ed0a3d007e9823bb  apps/api/src/di/generated/dependency.ts
d963cbb09245d7d10a394ac1eafce0c732c4966dface057a8b11ed03a59ad884  apps/api/worker-configuration.d.ts
```

## Frozen C independent-r1 integration and real maintenance acceptance — 2026-11-03

### Scope and integration integrity

The parent explicitly authorized the frozen handoff-independent-preferences-46-of-59 snapshot, manifest SHA-256 e78b61eea4bedc3cce32e028a921132a3d8022af3805fab8ad786a3c3762d0d9. All 26 snapshot file hashes were verified before integration. The B baseline was compared against shared-stable-final.json and each source diff reviewed. All 13 shared production files, including the unchanged barrel, now match C byte-for-byte. Existing files were changed through exact Read/Edit operations; only the new vectorIndependentPreferencesSmoke.ts was copied. C planning deltas, live files, configuration, dependencies and databases were not imported. No new DDL: Prisma source and all 65 historical SQL hashes remain unchanged.

shared-independent-integration.json records final shared/B/test hashes and overlap decisions. B's additional stored-image coverage assertions in vectorBackfillSuccessSmoke.ts and manual-redirect rejection regression in vectorV5.test.ts were retained; all other imported shared test files match C after formatting. No dev-local.ts, httpSmoke.ts, Edge transport, production resources, paid provider call, application version, shared client contract, commit or push was changed in this round.

### Actual B consumer changes

- independentPreferences.ts now uses the real shared userPreferenceTarget, preference_kind and preference_version, and maps authorized VectorV5RuntimeAdapter committed/materialized reads rather than inventing labels. Omitted legacy kind returns null; a persisted mixed accumulator/checkpoint was deliberately retained in the runtime test and never served as either independent preference.
- SharedRecommendationMaintenance handles each typed target separately. Legacy untyped orchestration can initialize both independently but cannot publish a mixed target. The temporary mixed/independent constructor switch was removed. A reader-user-history:independent-r1 per-user stage checkpoint preserves a completed article scan while Collection history continues, fixing a real alternating-completion loop found in Workerd. All contribution arithmetic and normalization remain C-owned.
- RecommendationLifecycle uses C changeTargetPage for bounded article -> Collection -> exact preference dependency expansion. It persists ten-target pages in reader-live:jina-v5-r1:independent-r1; old mixed acknowledgements cannot suppress new work. Source subscription changes call only collection preference. Deleted targets use shared cleanup.
- vectorMaintenanceInitialization.ts keyset-scans live users through reader-initialize:independent-r1, at most two users per job and two pages per kind, using existing sr_recommendation_work. No new ledger/table. The disabled-by-default maintenance flag continues to control native completion/hooks/cron independently of daily/search/source product flags.
- DailyReadingJobs receives only the minimum typed checkpoint-key compatibility update. Existing daily/ranking/curation code and tests remain retained and disabled; no single independent vector is passed off as the former mixed recommendation profile.

### Genuine Workerd/PG17/R2 matrix

Final command: SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/lifecycleSmoke.ts --maintenance-only. **Passed in 158.628 seconds**, with 46 independent branch checks and 103 saved resources plus 104 subscriptions. Native queue/workflow/DI, PG17, D1, R2 and KV are real; website/provider/moderation/index transport alone is offline. The original text/image/PDF native processing and old/new index continuity assertions remain.

1. Only-saved, only-subscribed and both users: each raw 1024-component sum and weight is independently recomputed from current authoritative user/bookmark/subscriber/Collection/member state, using the actual source representations, then compared at 1e-8. Exact by-ID materializations, independent target identities, revisions/published revisions, kind/version and cold-start are checked separately.
2. Three real source cancel/resubscribe cycles use ordinary CollectionController actions plus the real post-commit ledger hook. The article sum/weight/revision/published revision and Collection member accumulator remain byte-identical. Native REST star/unstar and local-first operations leave Collection preference state unchanged.
3. Actual DBSyncBatchOperation trash/restore and SyncController PATCH star, repeated same-state delivery, wrong-branch shared write rejection, own owner-starred Collection exclusion, source body replacement and member revision update, membership withdrawal/republish, natural expiry and resubscribe pass. Source content update leaves a different subscribed Collection contribution's key, representation, source revision and weight unchanged.
4. Empty Collection and empty user preference do not erase the other user preference. Old mixed state is retained as a negative fixture and legacy reads return null. Private history articles are not published as public content.
5. Both full histories exceed two 50-row pages: all 103 saves and 104 subscriptions are persisted before initialization, each target pauses with a real saved cursor, a later request resumes, and authoritative complete counts/materializations match. Native account deletion followed by late durable events leaves both accumulators absent and exact user reads unavailable. Zero daily jobs and zero source-processing work are asserted at completion.

The historical-fixture seed uses direct authoritative SQL, not manufactured contributions or normalized vectors. Mutation behavior uses original repositories/controllers; Collection candidate/publication records are synthetic fixture setup, not an enabled ingestion product. Full multi-request replica consistency, unbounded load and every media acquisition path are not inferred.

### Failures corrected or retained

- The first real independent run exposed a B orchestration bug: both kinds were restarted every time, so different page counts could alternate completion forever. Persisting the completed kind fixes it; a new focused regression creates a new maintenance instance between stages.
- A local-first fixture initially sent boolean true instead of the existing string '1' contract, so the following REST star was a real transition, not replay. The fixture now sends the genuine encoding and asserts the authoritative starred field before repeat checks.
- An initial enhanced 104-subscription attempt created subscriptions throughout an in-flight cutoff scan and asserted every new Collection had already published without completing a fresh pass/delta drain; it saw 102 ready dependencies and failed. That failed evidence is retained. Full-history initialization now seeds the stable authoritative history before scanning, while the preceding business mutation matrix separately drains the ledger after changes. No count or success condition was lowered; the final test still requires all 104.
- The fixture called ctx.cleanup twice after invoking a self-cleaning maintenance cron, producing pool.end noise. Only that test worker's finally block now avoids the duplicate cleanup; production ContextManager and transport architecture are unchanged.
- Intermediate focused tests failed solely on old missing-kind fixtures and removed mixed scan stages; fixtures were aligned to the real C signature while retaining all substantive scenarios. No shared C bug or second writer was introduced.

### Standard verification

- Standard isolated migration consistency and gen:all passed on owned PG17 with all 65 migrations; generated Prisma/DI/cron/router/Worker type output was not hand-edited. No schema diff.
- Full standard test suite: **232 files passed / 16 skipped; 2910 tests passed / 128 skipped**. Existing deferred product tests remain; database skips are not called passes. A later focused four-file run passed 27 tests including the new three initialization regressions; final typecheck passed.
- lint: **0 errors / 346 warnings**, including one C-retained unused _recipe compatibility parameter. typecheck and all four offline Worker builds passed. No dependency/runtime upgrade.
- Frozen C vectorIndependentPreferencesSmoke.ts additionally passed on actual PG17 in 16.965 seconds: legacy Collection/source-authoritative recomputation, three cancel/resubscribe cycles, branch cancellation, deletion, plan identities and legacy contract rejection.
- **Standard test:http ran exactly once this round and passed in 91.568 seconds.** This is an actual unchanged generated dual-Worker HTTP pass, not the dedicated matrix. Previous intermittent outer Miniflare Network connection lost failures remain historical evidence. No launcher/Edge/httpSmoke change or causal diagnosis was made; do not label the root cause fixed.
- No paid provider/index/cloud validation. Representative 50 MiB or large shared-resource PDF safety and real supplier mapping remain open. M.3/M.4/M.5 are locally verified; M.6 retains these external/causal gates.

Logs use /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/tasks/: final enhanced matrix bash-4t42asw8/output.log; initial successful 44-check matrix bash-602ehocq/output.log; failed evolving-history enhancement bash-143y4mg0/output.log; alternating-stage diagnosis bash-rcxr262b/output.log; sync encoding failure bash-tjbz3oew/output.log; standard gen/full tests bash-2y93pc4v/output.log; single standard HTTP pass bash-gq09a7lt/output.log.

### Review and precise file scope

Bugs review checked branch-specific revision preservation, typed routing/materialization, exact old-state subtraction delegated to C, source permissions, cold-start, deleted-user fences, finite retries/checkpoints and full-history resume. The real alternating-stage bug was fixed and verified. Security review confirms no new public vector endpoint, secrets, broad anonymous path, external data source or synthetic user identity. Compliance review uses vector-v5-recommendation, preserves the human's deferred products and C's exclusive core ownership, and records incomplete external gates without calling deferred work done. No release-ready claim.

The full exact shared/B/test source file list and SHA-256 map is in shared-independent-integration.json (SHA-256 1fdd95604065304ed7b5a1a79767f8892127f22f89c4e3804d1d59626b215c36). Final verification checked all 47 listed files with zero mismatches; strict OpenSpec passed 94/94 and git diff --check passed. Additional documentation changes are this validation.md, design.md and tasks.md. Standard generator outputs were regenerated; their tracked hashes remain unchanged from the preceding B maintenance slice. This round does not alter packages/contracts or CLI/Extension/Mobile shipped code; earlier cross-client version authorization remains the parent's independent gate. Final process/container inspection found no owned B generation/matrix/HTTP runtime remaining; other agents' resources were not stopped. HEAD and branch remain cfd51f552327edfc9d23dc00e4b1d088ec955fb3 / feat/vector-v5-recommendation. No commit, push, merge, reset, deployment, production operation or paid provider call occurred.

## Fixed dual Workflow release and bounded query consumers — subsequent 2026-11-03 instructions

### Current result and scope

The parent repeatedly paused the agent to relay explicit human corrections; before each resumed write, branch/HEAD and active B test processes were checked. Existing work was preserved. This slice implements the final instruction, not the superseded switch plan: current production SearchService always reads legacy encoder/five-index targets; native content Workflows keep legacy writes and independently dispatch VectorMaintenanceWorkflow from the committed R2 originals. No runtime SEARCH_ENABLED or MAINTENANCE_ENABLED remains in production source, generated Env declarations or the public configuration. A future approved code change can switch hybridSearch query encoder/index together without changing semanticNormalize or either writer. Daily, ranking/UI and source/Bot products remain unreleased.

W.1-W.4 and W.6 have local evidence. W.5 remains pending C's new whole-input/token-bisection, namespace/physical-capacity and ID-score-only authoritative query mapping contract. B did not alter shared codec, recipe, namespace, RPC or DDL algorithms for that request. The current C source still uses the earlier recipe and physical layout; this slice is not a claim that three physical indexes, whole-text-first splitting or new native batching are already integrated or remotely provisioned.

### Execution boundary

- New class: apps/api/src/entry/edge/workflows/vectorMaintenanceWorkflow.ts. Binding: VECTOR_V5_MAINTENANCE_WORKFLOW. The public example adds its native Workflow declaration; Edge exports the class; existing config generation maps the owner to Edge and references from Core. Worker types are generated from the updated generator source.
- VectorMaintenanceDispatch persists server-generated generation/entity/content-revision work identities in existing sr_recommendation_work before creating an instance. Same revision replays reuse its instance; unfinished/failed instances get bounded later attempts through persisted checkpoints. Recovery has one coalesced identity, not a Workflow per unbounded event stream. Missing binding/configuration throws explicitly, and deployment preconditions reject absent frozen v5 recipe/shards/Workflow declaration. No cloud resource is created.
- SearchService starts new Workflow admission independently of legacy normalization, waits for both admission/old-write outcomes, and propagates failure honestly. Legacy empty-provider result, missing route or swallowed upsert failure no longer looks successful. V5 embedding is not performed in the old Workflow step. Its job is independently durable and observable.
- The new Workflow re-reads the DB-bound job and current source eligibility. Params carry jobKey/instanceId only, no vector or arbitrary asset URL. It performs at most twenty durable steps per instance, bounded native retry and timeout, five ledger events and one user initialization page per step. C remains the sole accumulator/normalization/publication writer. Partial completion persists; later Cron admission continues it.
- VectorMaintenanceJob performs only bounded source/legacy expiry updates and dispatch/recovery discovery. REST/local-first hooks only dispatch recovery. SourceCollectionActions no longer synchronously aggregates subscriptions. No Cron or HTTP hook runs article embedding/full-history work. Native source bytes, snapshots and publication rules remain unchanged.

### Genuine dual execution and retry evidence

Command: SLAX_API_SKIP_DOTENV=1 pnpm --filter slax-reader-backend exec tsx --tsconfig tsconfig.json test/runtime/lifecycleSmoke.ts --dual-workflow. Final execution passed in **66.414 seconds** on real Workerd Workflow, PG17, R2, D1 and KV. Only external website/provider/moderation/index transport is offline; the real old/new Workflow units, original capture pipeline, shared C implementation and DB operations execute.

- The new-provider-failure case leaves two v5 article manifests nonready while the original CrawlWorkflow completes and legacy vectors exist. Clearing only the provider failure lets the new Workflow retry and complete independently.
- The legacy-provider-failure case leaves the original Workflow noncomplete and its legacy vector absent while v5 completes. Clearing only the old-provider failure lets the original Workflow retry; new contribution identity does not multiply.
- Actual instance IDs differ and their engine statuses are separately queried. Final two old and two new instances all report complete. R2 content keys and DB content revision remain identical after retries; the counted external fetch total does not increase after original publication. The new Workflow never recrawls the website.
- Current real SearchService uses the old query route and returns business-hydrated ID/score-derived results without embedding/value fields. A test-only explicit call to the retained future v5 query helper records the distinct query target and leaves all write/contribution state unchanged; this does not activate v5 serving.
- Real ordinary subscription cancel/renew and Collection member body revision update are dispatched through the new Workflow. Article preference raw sum/weight/revision/published revision stays unchanged across subscription-only mutations; Collection member state stays unchanged when only subscribers change.
- A 103-record saved history is initialized by the Workflow through persisted bounded pages; its authoritative count and 1024-dimensional accumulator match all records, with matching committed/published revision. No direct test call to aggregate/drain performs this acceptance work. Cron calls only dispatch and light expiry.
- Stored substantive image and original-PDF fixtures execute legacy indexing and independent v5 Workflow coverage, including positive required image/PDF coverage; fetch count remains unchanged. This is not representative large/shared-resource 50 MiB safety or real vendor request mapping.
- Daily jobs and source-processing work stay zero. User article and Collection preferences remain independent-r1 with explicit kinds; no mixed fallback.

### B query-consumer limits and C dependency

Current private SearchService hydrates current ownership/tag rows and snippets in ID batches no larger than 100, with no per-hit DB query. Legacy VectorizeRepo requests returnValues=false/returnMetadata=none, limits native fanout to four batches and retains top 30 ID-score results. Its exact remote legacy RPC already defaults to no values/metadata; no shared v5 RPC signature was changed. The v5 private consumer merges only a bounded top 100 and returns IDs/scores. nativeCandidates is a separate reusable consumer port with deduplication, maximum 500 candidates and 100-ID sequential authorization/hydration batches; unit tests demonstrate foreign-ID rejection and bounded fanout. It is not yet wired to a new C native ID-mapping API.

The existing shared C v5 query still requests metadata and performs its old mapping; B did not bypass that authority or manufacture new ID semantics. Thus full new-v5 ID-only/native batched mapping is explicitly incomplete until the parent hands off C's frozen slice. Existing exact-user profile getByIds reads are retained; no all-user vector scan or full user-by-article similarity matrix was introduced. Recommendation generation remains disabled and is not expanded here.

### Frozen correctness and HTTP patches

Fixed-key/expiry snapshot manifest 4fb6da774ba9f713811e2ed656c9433bc43d32ce97d8f415c0ea967603587a38 was verified with every after hash and all five before hashes. The five shared production files now match C exactly: contract, writer, sources, coordinator and local backfill runner. This adds prepared object receipts, revalidates source ownership and up to three original key/ETags at publication, rejects stale same-revision replacement and refreshes eligibility once on explicit resume/verify. No preference ID or DDL change. New fixed-key and resume-without-ledger-event regressions pass. New source lifecycle scenario files were imported but not claimed separately run in this slice.

The authorized HTTP snapshot ea8cf11f870163a20fcf7bcd095bc8105595a4bb38b74d561995d4d9782e9b13 was hash-verified. Only Edge request = new Request(request.url, request) and matching rejected-body ownership assertions were merged; B source-machine routes and the new Workflow export remain. No dev-local.ts/httpSmoke.ts/framing/dependency change. The imported httpBodyLifecycleSmoke file is retained, not claimed separately executed. **Exactly one standard test:http run passed in 37.184 seconds**. Prior failure logs remain historical; the parent/C owns broader HTTP diagnosis evidence.

### Shared bug requiring C follow-up

The exact fixed-key snapshot rejects a legal-looking source with identical content_key and content_md_key: prepareArticle emits two {key,etag} receipts; validatePublication checks objects.filter(value => value.key === key).length !== 1 and returns false, so publication stays source_changed. This was reproduced by the initial Collection body-update fixture (bash-snz7j17s). Location: vectorV5Sources.ts validatePublication object-key multiplicity check and prepareArticle objects assembly. B did not patch the shared algorithm; the final runtime fixture uses distinct native HTML/text originals. Parent/C must determine whether all existing same-key records should be supported and deduplicate or explicitly reject the source contract. Do not call that edge case repaired.

### Commands and honest status

- Standard owned local migration consistency + gen:all passed; 65 SQL migrations replay unchanged, no Prisma schema change. Generated Env contains Workflow binding and removes the obsolete toggles.
- typecheck passed; complete test suite **235 files / 2921 tests passed, 16 files / 128 tests skipped**. Final five-file dispatch/config/bounded-query tests passed 22 tests. No deleted/skipped original test was used to make the suite green.
- lint passed with 0 errors / 347 warnings on the combined run (one later unused future-query import was removed); all four offline Worker builds passed. No dependency or runtime upgrade.
- Single standard test:http passed as above. The dedicated dual Workflow success is separate evidence, not its substitute.
- Earlier failed runs are retained: old fixtures lacked new required Workflow/config prerequisites; postprocessing tests expected swallowed errors and were updated to assert Workflow retry while preserving other callback execution; query fixture initially omitted normal cache invalidation after direct repository seed and was corrected; fixed-key same-object fixture exposed the shared issue above. Assertions were not relaxed to accept missing vectors.

Logs under /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/tasks/: final multimodal dual Workflow bash-j99rv0nv/output.log; initial dual isolation bash-acfnqkmj/output.log; enhanced Workflow/history/query success bash-3vt3rekn/output.log; shared duplicate-key timeout bash-snz7j17s/output.log; final complete checks bash-3e9zvs3t/output.log; single HTTP bash-435l3a95/output.log.

### Review and handoff scope

Bugs/Security/Compliance review verifies fixed legacy query, unconditional independent write admission, explicit failures, native retry isolation, permission rechecks, DB-bound Workflow params, bounded loops and unchanged C math. No public vector endpoint, private config read, unapproved dependency, cloud resource, paid provider request, production migration or deployment was introduced. No commit/push/reset/merge. The proposed future three physical targets, namespace isolation, whole-input/bisection, mapping and native batching remain C-owned unintegrated work; real account/index capacity and vendor calls remain unverified.

workflow-dualwrite-integration.json lists the exact touched production/test/generated paths and hashes plus preserved recipe/schema/tooling hashes; SHA-256 de8107eb7e81aec19d2773f0ce314b0d203ef6df4c3d53bf29f75ac0e4c155f4. Final verification checked all 55 listed hashes with zero mismatches, git diff --check passed and strict OpenSpec passed 94/94. Owned B test containers/processes are absent; other agents' resources were not stopped. Documentation changes are proposal.md, design.md, tasks.md, this validation.md and specs/vector-v5-runtime/spec.md. Prior hash manifests remain historical. Existing deferred daily/curation/UI/Bot work is preserved, not claimed complete.

## Worktree1 integrated foundation — final namespace correction, 2026-11-03

### Authority, scope and inputs

The human stopped the parallel tasks and authorized one implementation owner in this worktree to finish the foundation. The former C tree remained frozen/read-only. The parent SPEC was read once; it was not edited. Current order: foundation first; recommendation and synchronization scripts only after foundation; daily reading proposal after those later workstreams. Earlier C-first/B-later rollout and article recipe namespace assumptions are superseded. Historical code/tests are retained, not counted as newly delivered products.

foundation-inputs.json records one input hash list for the thirteen foundation source/test files inspected from frozen C and final integrated hashes. New files imported: textBudget.ts, batch.ts and vectorV5Batch.test.ts. Existing writer, source, repository, codec, recipe, contract, physical buckets/gate, remote adapter and AI RPC changes were merged precisely. The source vectorEntityRefresh was inspected to understand batching but was NOT imported; no vector-refresh CLI, bulk HTTP/admin product, new coordinator platform or DDL was added. Existing B Workflow, permissions, private copies and independent preference logic remain. All 65 historical SQL files and Prisma schema hash remain unchanged.

### Three libraries and task compatibility

- Article physical index: article content, default namespace, one current symmetric-r1 content space used by Collection/user calculations. Live articleOutcome no longer writes a second retrieval article set.
- Collection physical index: Collection content aggregates, default namespace. Subscriber-only changes do not change these records.
- User physical index: distinct IDs in user-article and user-collection, selected from actual preference_kind; independent-r1, raw sums, revisions and publications remain separate. Mixed-kind native upsert is permitted on the same physical gate; exact ID reads validate kind/version/revision/namespace. No user preference is stored in the Collection content index.

Bucket-only routeNamespace refuses user_preference without kind. targetNamespace and storedNamespace handle target/per-record selection; write/RPC/readback all use the rule. Registry/config reject incompatible recipes sharing one physical default namespace. Existing retrieval-r1 helper returns private_vector_query_space_unconfigured when absent, before encoding; current public search is still hardcoded legacy. No incompatible tasks are compared and no future recommendation/query product is silently enabled. A later search cutover still requires a compatible task decision; this foundation did not reselect a model/task.

The parent reports actual creation/get verification of reader-test-v5-article/user/collection under account 52bb95cdad45ee5441e67b3a1e9dce5b and reader-prod-v5-article/user/collection under f74694cd77e247e071af286f40d20116. All are current Vectorize, 1024/cosine. Public template comments name them; they are not deployed by the template. No bindings, metadata filters, vector writes, provider calls or monitoring were configured by this agent.

### Six current acceptance points

1. **Independent dual Workflows:** final --foundation-integrated run executes actual old CrawlWorkflow plus new VectorMaintenanceWorkflow. Either provider failure leaves the other generation able to complete. Both engine instance states complete after independent retry, no website refetch and no stored revision change. Cron/hooks perform light expiry/admission/dispatch only. Native image/PDF paths and 103-history Workflow continuation remain exercised; daily/source work stays zero.
2. **Whole-input and bisection:** whole-bisect-r2 estimates complete title/body UTF-8 bytes conservatively as a token bound with explicit overhead/safety/request budgets. Fitting four short inputs remain single ranges. Long multilingual body and identified INPUT_TOKEN_LIMIT_EXCEEDED bisect into contiguous ranges whose concatenation equals the full original. Group length errors are diagnosed per entry so unrelated fitting articles do not split. No truncate, omitted tail or alternate splitter. Symmetric text keeps a bounded sum and one article aggregate.
3. **Native bounded storage/query:** actual provider transport receives grouped input arrays; native upsert receives grouped records under item/serialized-byte bounds. Session waves are capped at eight, request batch at fifty, PDFs serialized. Physical gate accounting is keyed by actual physical index; both user namespaces share one gate. Database-backed queries request returnValues=false/returnMetadata=none and map up to 100 IDs in one authoritative current-manifest query, with a Map instead of per-hit database calls. Revoking a current manifest excludes its still-present index ID.
4. **New/existing users and Collections:** --foundation-new-users runs real UserRepo.registerUser beyond an already advanced initialization cursor, proving discovery does not depend on profile tables. Registration alone creates no global Workflow task. Empty users have cold-start/no zero publication. Native first save runs both writers and produces article preference only; subscriber-only user gets Collection preference and no saves. Both branches, cancel/rejoin, sync delete/restore and Collection create/rename/member-update/clear pass against original source tables with 26 separate 1024-component recomputations, no bulk run or daily product.
5. **Reusable service:** VectorFoundationService.articles(targets) provides bounded outcomes for the current configured article content recipe; aggregate(target,pageBudget,workScope) and preferences(authenticatedUserId) reuse shared contribution/publication/exact reads. The barrel exports the service, budget and batch utilities. No caller vectors/index SQL accepted, no new product endpoints.
6. **Combined verification:** the above runs use the integrated worktree's real PG17/R2/Workerd/Workflow/DI and current shared source, not separate-tree passes. External website/provider/index transport is explicitly offline. Standard generation, typecheck, full tests, lint, four offline builds and a single standard HTTP run pass as recorded below.

### Correctness repairs during integration

- A real Collection content update intermittently left one subscriber stale. The deterministic regression proved that a newer event could complete an older unscoped target's publish checkpoint without rescanning history. B aggregate checkpoints now include event:<ledger-id>, propagated through dependent Collection scans, while initialization retains its own scope. The pre-fix test failed (zero history reads); the fixed test and new-user runtime pass. This changes orchestration ownership, not contribution arithmetic or event capture.
- Fixed-key source receipts now deduplicate matching content_key/content_md_key and reject conflicting ETags. Same-key publication and later replacement rejection have a passing actual-writer regression; the earlier recorded shared same-key bug is now repaired in the authorized sole-owner worktree.
- Native grouped provider length failure initially affected unrelated entries. Results are now attributed per entry; only specifically failing inputs are subdivided. Native retries/errors remain explicit and no success is fabricated.
- **Rejected historical implementation, superseded below:** textPolicy.maxSourceBytes imposed a 2 MiB default / 4 MiB maximum whole text/HTML ceiling. The parent explicitly rejected this unapproved support reduction; the field and text_processing_limit guard have been removed. The earlier passing small-source evidence did not establish large-source acceptance. Conservative token estimation remains an estimate, and PDF safety is unchanged.
- Deletion native batches retain the existing 100-ID RPC bound; upsert uses configurable native record/byte packing up to 1000. Batch sessions detach in finally to avoid retaining a previous request session.

### Final actual commands/results

All API runs use SLAX_API_SKIP_DOTENV=1 in the B tree. No private configuration was read.

- Standard recommendationMigration.ts harness: all 65 migrations, schema consistency and gen:all passed; no schema delta.
- pnpm api -- typecheck: passed after integrated source merge.
- pnpm api -- test: **238 files passed / 16 skipped; 2934 tests passed / 129 skipped**. One earlier full run exposed only seven fixture/config/event-argument regressions; those were fixed, focused checks passed and the final full run passed. Skips remain unverified, not passes.
- pnpm api -- lint: **0 errors / 347 warnings**. Four Worker pnpm api -- build offline bundles passed.
- lifecycleSmoke.ts --foundation-integrated: final run **105.412 seconds**, both real Workflow failure paths plus 103 history, images/PDF, six foundation article targets, four whole short inputs, estimated/provider bisection, actual grouped provider/index writes, authoritative ID-only query and corrected namespace assertions passed. The preceding post-namespace run also passed (115.511-second combined focused/runtime command).
- lifecycleSmoke.ts --foundation-new-users: **41.199 seconds**, real users 3/4/5 discovered after cursor 2; empty, first operations, independent transitions and Collection lifecycle passed, 26 recomputations, bulkRuns=0/productJobs=0. Earlier unscoped checkpoint failures are retained as diagnosis evidence, not called successful.
- pnpm api -- test:http: **one attempt, passed in 42.396 seconds**, with the previously authorized body-ownership repair preserved. No framing/launcher/dependency modifications or retry-until-green.

Logs under /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/tasks/: final integrated bash-4buywaxl/output.log; initial corrected namespace bash-k21nnxc7/output.log; new users bash-qa98lv4e/output.log; final full tests/lint/build bash-il8ttp81/output.log; single HTTP bash-10vwo18d/output.log; generation and earlier regression report bash-ps66bssw/output.log. Interrupted run bash-4yb1gel4 was stopped by the parent and is not a pass. The first batch fixture had an escaped-string syntax error; another used an unsupported synthetic overflow code and was corrected to the existing explicit length code, not a widened provider heuristic.

### Remaining boundaries and handoff

No cloud index was created/modified here; the six indexes exist per parent evidence. Bindings/filters, actual Jina request/output mapping, real native remote mutation visibility, representative large/shared-resource/50 MiB PDF support and live release remain external/authorization gates. The default namespace stores the foundation symmetric content only; future retrieval search cutover must not bypass the current explicit unconfigured-space rejection. Recommendation, full refresh CLI/API and daily reading are later tasks; their existing unpublished code is preserved. No commit, push, merge, rebase, deployment, production connection, paid call or monitoring.

The preceding integration snapshot used foundation-inputs.json SHA-256 0d78a961f1764c36dad6913a9651c3f52cc4e5c7926b7cb929814cc8db0f1c1c with 32 output hashes. It is historical, not the final source-range repair fingerprint. Input provenance is preserved; current output hashes are refreshed after the repair. Earlier 65-SQL / strict OpenSpec 94/94 / cleanup checks remain historical evidence, with current checks recorded below. Source ownership stays entirely worktree1; no source C/main/Bot files were changed.

## Whole-source ceiling removal and bounded original ranges — 2026-11-03

### Implemented correction

- Deleted textPolicy.maxSourceBytes and whole text/HTML rejection. No replacement total-size ceiling. Existing original R2 keys are read using explicit offset/length; no staging copies, extra service, new table or migration. Unsupported/mismatched range metadata and changed ETags fail explicitly instead of falling back to full-body reads.
- Text processing keeps a 32 KiB binary-partition leaf plus at most three UTF-8 continuation bytes. Per-page token/JSON budgeting and explicit provider overflow subdivision preserve all body characters; title bytes are not counted as body coverage. Byte/character cursor, unfinished ranges and a 1024-number text pool are atomic manifest state; successful pages discard their historical fragments/ranges. Complete coverage equals the entire original byte size. Blank original validation is retained with a cumulative hasText flag.
- Preparation occurs before the existing writer lease, so a second prepared page could otherwise be applied after another worker advanced the cursor and compacted its fragments. A bounded preparation-cursor comparison inside the lease rejects source_progress_changed before inference/pooling. A deterministic actual repository test captures the old page, advances another writer, then replays it and verifies no state or pool change. This is a concrete duplicate-pooling repair, not a new concurrency platform.
- HTML uses independent native HTMLRewriter scans from 64 KiB original ranges. Large text processing defers large HTML/images. At most one selected URL and one lookahead are retained, with bounded caption/context. A durable lexical URL cursor preserves unique image coverage without an ever-growing seen-URL set; large HTML uses URL order, ordinary small HTML retains document order. This trades repeated original reads for bounded source memory and does not drop late images.
- Whole-text image preparation is one image per step. Foundation waves are formed before the provider barrier with at most eight targets and 64 MiB conservative source/payload reservations; heavy HTML/PDF is exclusive. Source keys/ETags fence preflight assumptions. The measurements below quantify actual active raw buffers and prepared/request bytes, not only Promise counts; reservations are not an exact isolate heap or adversarial parser-allocation guarantee. PDF safe-support scope is unchanged.

### Executed cases and measurements

- vectorTextRanges.test.ts: 20 exact boundary combinations (English, Chinese, emoji, code and BOM patterns at 2 MiB/4 MiB plus/minus one byte), plus ignored/short/changed-range rejection. Every page equals the corresponding original substring, final streaming SHA-256 equals the complete original, UTF-8 boundaries are intact, and no full large object read is allowed.
- vectorLargeText.test.ts: real PGlite repository/writer, fresh source/writer instances between steps, transient provider 503, complete streaming body hashes, persisted partial cursors, stale prepared-page replay rejection, replay with no inference, one aggregate and one idempotent contribution per article. Source lengths 2,097,151; 2,097,153; 4,194,303; 4,194,305 bytes, plus a whole short input. Final focused peaks: raw read 131,103 bytes; retained prepared input 283,611 bytes; provider request 70,376 bytes.
- vectorFoundationBytes.test.ts: ten mixed targets with seven actual 5,000,000-byte images plus large text. Peak image buffer 5,000,000 bytes; retained prepared payload 6,737,637 bytes; raw source buffers 32,876 bytes; maximum simultaneous targets two under reservations (not a hardcoded serial-only test). All seven images prepare; no heavy source was rejected for total size.
- Native Workerd suite: 4/4 pass. More than 4 MiB decorative markup plus first/tail images, captions, duplicate URL, navigation and outside-article exclusions; full HTML reads forbidden; range peak at most 65,536 bytes. This one HTMLRewriter case is explicitly skipped under the Node runner, which has no native parser, and is exercised here rather than replaced by a DOM shim.
- Real PG17/Workerd/R2 lifecycleSmoke --foundation-large-text passes on final cursor-fenced code in 36.449 seconds. It processes originals of 2,097,151; 2,097,153; 4,194,303; 4,194,305 bytes plus 2,000/21/29-byte bodies. An offline provider compares every successfully submitted body byte to the corresponding original R2 range before incrementing a bounded audit cursor. Complete beginning/middle/end coverage, durable 503 resume, real grouped overflow followed by single-entry diagnosis, unchanged one-input short neighbors, two giant-markup images, seven single contributions and no new original copies pass. Peak raw source ownership 65,542 bytes; peak retained prepared inputs 289,946 bytes; 535 range reads. Replays do not call inference or duplicate contributions. Audit objects contain counters only, not source copies.
- Preserved integrated scenario passes in 108.443 seconds: both real old/new Workflow failure directions recover without refetch/revision change, 103-history continuation, images/PDF, three physical libraries, default content namespaces, user-article/user-collection separation, grouped provider/native writes and ID-score authoritative mapping. The large-text loop itself uses repeated calls to the existing foundation service with new request contexts, not a claim that one Workflow instance handles an unbounded article. Existing Workflow 20-step instances retain checkpoints and redispatch through the current durable work row.
- New-user runtime passes in 40.892 seconds with 26 authoritative recomputations, first-save dual Workflow, independent empty/subscriber/both branches, Collection create/update/clear, bulkRuns=0 and productJobs=0.

### Standard checks and retained failures

- Isolated recommendationMigration.ts runs all 65 migrations, reports schema already in sync, and runs standard gen:all. No Prisma change or new migration. Final typecheck passes.
- Final complete standard suite: **241 files passed / 16 skipped; 2957 tests passed / 130 skipped**, 64.48 seconds Vitest / 66.230 seconds command. Skips are not passes. The earlier current-round full run failed only because the native HTMLRewriter test was also collected by Node; it now explicitly requires Workerd, where it passes 4/4.
- Standard lint: **0 errors / 347 warnings**; final touched-source lint has 0 errors / 1 existing unused-parameter warning. Four final standard offline Worker bundles pass with the public example config, without deployment. An intermediate app-relative config argument failed before build (the wrapper resolves from repository root); corrected root invocation passed. An earlier tsx inline helper produced no build output and is not counted as build evidence.
- Exactly one standard test:http attempt this correction round passes in **40.395 seconds**, including add/list/delete/fulltext/diagnostics and source-share assertions. No HTTP transport patch or retry loop was added. This run predates only the local cursor replay fence; final real R2/PG/Workerd range acceptance and full tests exercise that fence.
- Initial typecheck caught R2 range union compatibility and required native TextDecoder options; both were corrected, not hidden by casts or fallback reads. Prior red logs are preserved.

Log directory remains /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/tasks/. Final large source: bash-ze91vth2/output.log; native Workerd and prior large source: bash-6chqi9r7/output.log; integrated dual Workflow: bash-b0vps0tv/output.log; new users: bash-t1yw3tj5/output.log; final full suite: bash-xc4mment/output.log; earlier Node mismatch: bash-07oim52q/output.log; corrected full suite before cursor fence: bash-lrcxp8gi/output.log; single HTTP: bash-8gewc68n/output.log.

### Review and boundaries

Bugs pass: source ranges, exact UTF-8 boundaries, partial progress/compaction, provider isolation, stale prepared-page replay, complete image selection and repeated contribution identity reviewed and exercised. Security pass: original ETags/revisions and publication checks remain; no credentials/body logging, unapproved network endpoints or dependency added; public image validation still applies. Compliance pass uses vector-v5-recommendation and the parent's explicit ceiling-removal correction. Namespace, symmetric-r1-only foundation, legacy search and independent dual writers remain unchanged. No Important finding remains in this scoped correction; the external gates are not claimed complete.

Not verified or authorized: paid Jina tokenizer/request mapping, real remote Vectorize mutation visibility, deployed bindings/filters, representative large/shared-resource/50 MiB PDF safety, unlimited adversarial HTML native-parser heap, sustained concurrent-isolate load or arbitrary-sized end-to-end Workflow runtime duration. Actual HTML/source byte ownership is bounded and observed, not a claim that every engine allocation is measured. Large HTML selection order/context differ as documented in design.md. No UI/Bot/recommendation/daily/bulk synchronization work resumed. No commit, push, merge, rebase, deployment, production connection or cloud resource mutation. Six existing indexes remain as reported by the parent. This API-only correction does not add a CLI/Extension/Mobile shipping change or bump a version.

Parent-verified prior foundation-inputs.json SHA-256: a9b0b080cef630aee7799ff7cd00b3676f79dd06b2b225b452e9ee20e4af4a30, 41 output hashes. Its original-byte and other foundation results remain valid, but parent review correctly found that they did not prove whole-first model inputs: a 32 KiB R2 page still determined model splitting. This snapshot is superseded only for the focused correction below. Prisma SHA-256 remains ba43ec15f0cd350f34dc42c5a94bc6f0ecfc32d27dc8af12f9c0cdf283891e30, with 65 migrations; no DDL changed.

## Whole-first model boundaries, independent I/O pages — final focused repair

F.2 and F.6 were reopened before implementation; F.1/F.3-F.5 acceptance remained intact. Only the existing foundation source/budget/checkpoint and related tests were changed. No new architecture, storage, dependency, downloaded tokenizer/model, product, monitoring or external service.

### Red → repair → green

- First added vectorWholeInput.test.ts and ran it on the old implementation: **3 failures / 1 pass**, before source changes. The 70 KiB English, 48 KiB Chinese and 60 KiB mixed article assertions expected one exact complete title/body input but received **4 / 2 / 4 inputs**. This is direct evidence of the rejected I/O-boundary behavior, not a rewritten expectation. The red output is retained in this agent's tool event log (20:58:38).
- After repair the same four tests pass: all three fitting articles produce exactly one input; 8 KiB and 32 KiB transfer settings give identical inputs; a 300 KiB estimated-overflow article splits identically for either setting and concatenates to the complete original. Exact title/body equality is asserted at the codec transport boundary.
- Focused tests pass **52/52** across whole-first, large-body persistence, mixed active bytes, grouped provider behavior, original UTF-8 boundaries and existing provider subdivision repairs. Stale prepared-page fencing, 503 interruption, 4 MiB-plus original hash coverage, provider explicit length failures and per-article contribution identity remain passing. Old assertions that equated bytes with tokens were replaced with explicit heuristic-budget assertions; complete original-byte hashes and request byte bounds were not relaxed.

### Boundary rules and memory

- Existing youtubeArticle.estimateTokens already uses character-based CJK/other estimates. The foundation applies a small local, versioned multilingual-heuristic-r1 strategy: ASCII letters/whitespace 0.25 token; ASCII punctuation/digits/code symbols 0.5; Han/Hiragana/Katakana/Hangul 1; pictographic emoji 2; unfamiliar characters fall back to UTF-8 bytes. It is an estimate, not accurate Jina tokenization; actual token-limit feedback still bisects deterministically without truncation. Existing configurable safetyFraction and overheadTokens remain.
- The first candidate is the entire source. Because every character in this estimate costs at least its UTF-8 bytes divided by four, the source byte count provides a valid lower bound on this heuristic (not a claim about real tokenizer tokens). Only candidates provably exceeding that model allowance or strict request byte allowance are bisected before materialization. Near-middle paragraph/sentence boundaries are selected from a bounded 768-byte original probe. Remaining ranges persist as a depth-first traversal stack in the existing manifest; no body copy is stored.
- A candidate that might fit is read through at-most-32-KiB R2 pages into a single bounded string, then complete title/body heuristic and exact JSON bytes decide whether to encode once or subdivide further. I/O page size is not the candidate bound. The maximum possible candidate is below 124,519 bytes under the schema's 32768-token/0.95 maximum policy; the normal fixture allowance is about 104 KiB before title/overhead. This is derived from model policy, not an article support ceiling. The 64 MiB wave reservation now separately includes a raw transfer page and 16 times the model-derived candidate allowance. No whole original is rejected for size.
- Recipe digest includes the heuristic identifier so old byte-estimator manifests cannot silently satisfy the new policy. This is not a model/task-purpose or namespace change. Old search and independent dual Workflows remain untouched.

### Actual local runtime and standard checks

- One focused real PG17/Workerd/R2 run passes in **38.566 seconds**. Existing offline provider audits compare every accepted body byte to the original R2 range and explicitly check the title prefix. Added 71,680-byte English, 49,152-byte Chinese and 61,440-byte mixed bodies each have **exactly one provider input**, while 2/4 MiB plus/minus-one sources remain fully covered. The run also proves explicit grouped token overflow followed by isolated attribution, no split for fitting neighbors, 503 durable resume, ten one-per-article contributions, unchanged giant-HTML two-image coverage and no new original objects. Runtime source buffer peak **98,343 bytes**, retained prepared inputs **569,674 bytes**, 866 range reads. Log: tasks/bash-gh7nyszx/output.log.
- Actual repository test peaks: source reads **131,072 bytes**, prepared inputs **563,319 bytes**, provider JSON **209,459 bytes**. Mixed seven 5,000,000-byte image case has peak image bytes **5,000,000**, prepared payload at most **6,806,922**, source range **32,768**, maximum simultaneous targets two under the existing 64 MiB reservation. These measure active byte ownership, not exact isolate heap or native parser memory.
- One final standard typecheck/full test/lint invocation passes: **242 files / 2961 tests passed**, **16 files / 130 tests skipped**, Vitest 73.60 seconds, lint **0 errors / 347 warnings**. Log: tasks/bash-bfiu7a4n/output.log.
- Existing isolated recommendationMigration harness reports all 65 migrations already consistent and runs gen:all; four standard offline Worker builds pass. No migration or generated-file hand edit. Unrelated F.1/F.3-F.5 runtime scenarios and HTTP acceptance were deliberately not repeated this round; their parent-accepted prior evidence is retained.

Logs are under /Users/daguang/.kimi-code/sessions/wd_slax-reader_08806313fb8b/session_54207c5d-6a97-4d73-b5ae-6c0619761b69/agents/agent-404/. No real vendor was called. Heuristic estimation may under- or over-estimate actual model tokens; provider rejection is the safety backstop, and no 32K utilization accuracy claim is made. Existing PDF, cloud, deployment, cross-isolate load and parser heap gaps are unchanged. No commit/push/merge/reset/rebase/deployment/production/paid-provider/cloud mutation. Final foundation-inputs.json SHA-256 is c27dc0e1d61b6c39036b3b8d3de61011d52ffe184d2a85242b1bc829ed900282: all 42 output hashes verified against disk, 13 frozen provenance inputs unchanged. Schema hash remains unchanged and migration count remains 65. Final git diff --check passes; strict OpenSpec passes 94/94; owned container list is empty. F.2/F.6 are complete for the focused local requirements; the external vendor/release/PDF gates remain open.

## PDF size-policy test-owner verification — 2026-11-04

This pass verifies the human-approved PDF policy revision (original PDF at most `8_000_000` bytes sent once to Jina; larger accepted PDFs use already extracted text without reading the original body) and the existing vector/media regressions. It is an agent-executable, local runtime verification only. No production logic was changed to make tests pass.

### Verified contract and scope

- Original PDF `<= 8_000_000` bytes, including exactly `8_000_000`: one provider request carrying the byte-identical original PDF, no page splitting, no extracted-text key required.
- Original PDF `> 8_000_000` bytes, including `8_000_001`, `9 MiB` and `50 MiB`: HEAD-size routing to the existing extracted-text embedding path; zero original-body GET/read and zero PDF-provider calls; the unchanged 50 MiB source-upload limit is represented by the 50 MiB HEAD metadata case.
- No PDF page splitting, staging objects, re-OCR or new parser is present in the exercised production path.
- Test-only files were added or updated; the only production edits in this pass are repository-Prettier formatting in `apps/api/src/domain/podcast.ts` and `apps/api/src/domain/youtubeArticle.ts` (no semantic change). `pnpm api -- gen:all` generated its outputs; no generated file was hand-edited.
- No schema, migration, dependency, upload-limit, secret-file, Git-branch/reset/stash/commit/push or cloud operation occurred. No service was restarted and no live provider was called.

### Focused tests and exact results

- New `apps/api/test/domain/vectorPdfPolicy.test.ts`: **15 tests passed**. It covers:
  - exact `7_999_999` and `8_000_000`-byte originals (valid PDF padded to the exact byte length), one request, byte-identical base64, two mapped pages, no text key;
  - 40-page direct PDF in one request with a stubbed response larger than 2 MiB but within the page-scaled response allowance;
  - repeated PDF refresh re-embeds instead of reusing prior PDF vectors;
  - `8_000_001`, `9 MiB` and `50 MiB` HEAD-only originals with a GET guard that fails the test if the original body is read, a `PDFDocument.load` spy asserted uncalled, text-only provider inputs, correct `text_key`, and no PDF request;
  - complete 1.4 MiB UTF-8 extracted text preserved across the 1 MiB storage-read split and model subdivision, with the title prefixed once;
  - missing key (`missing_source_text`), missing stored text (`missing_source_body`), empty and whitespace-only text (`missing_source_content`) failing with no representative, and a `503` provider failure staying failed;
  - stale chunk cleanup when a 3-page direct PDF becomes a large text-only refresh, with the second owner's representative and chunks unchanged, followed by isolated owner deletion;
  - non-PDF HTML refresh still reusing unchanged content without a second provider request.
- `apps/api/test/utils/vectorEmbedding.test.ts`: **15 tests passed**, including a new client-level case accepting a >2 MiB 40-page response, rejecting a response above `pages * 64 KiB`, and rejecting wrong model, wrong page count, duplicate/out-of-range indices, zero and wrong-dimension vectors, and HTTP failure.
- Replaced `apps/api/test/utils/vectorPdf.runtime.test.ts` (the obsolete visual-splitting test) with actual Workerd/Miniflare coverage: **1 test passed**. The 50 MiB original exists only as HEAD metadata (its GET increments a counter and throws); the extracted text is a real Miniflare R2 object; 0 original reads, text-only provider requests, and joined text equal to the stored text with one title prefix. The same runtime sends a real 40-page PDF directly, receives a >2 MiB response, and validates 40 page vectors and byte-identical base64. Inspector sampling (16 valid samples) reported heap peak `10,724,544` bytes, backing peak `697,744` bytes and combined peak `11,422,288` bytes against the test's 64 MiB bound. Provider transport in Node and Workerd is a local stub; Miniflare R2 is local.
- Combined focused vector/media run: **13 files, 237 tests passed** (`vectorSources`, `vectorEmbedding`, `vectorPdf.runtime`, `vectorPdfPolicy`, `vectorMaintenance`, `vectorMaintenanceHooks`, `vectorMaintenancePublication`, `mediaSnapshot`, `mediaRecovery`, `bookmarkImportMetadata`, `vectorMaintenanceRebinding`, `vectorMaintenanceSync`, `vectorMaintenanceWorkflow`).
- Final standard API suite after generation: **213 files passed / 14 skipped; 3,111 tests passed / 114 skipped (3,225 total)**. Skips are unverified, not passes. No test was deleted or skipped to make the suite green.

### Standard checks on the final tree

All commands ran from `/Users/daguang/project/slax-reader` with `set -o pipefail` and reported `PIPESTATUS`/native exit codes; the previous `| tail; echo $?` masking is not used.

- `pnpm api -- gen:all`: passed. Model, Worker type, cron, consumer, router and DI generation completed; Prettier rewrote generated files as usual.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: **0 errors / 343 warnings** (warnings are pre-existing `any`/unused-parameter findings).
- `pnpm api -- build`: all four standard dry-run bundles (`core`, `edge`, `ai`, `browser`) passed; no deployment.
- `pnpm exec openspec validate --all --strict`: **92 passed, 0 failed**.
- `git diff --check`: passed.
- Code snapshot: branch `fix/android-storage-path-alias`, HEAD `83534757`. SHA-256: `src/utils/vectorSources.ts` `3a9034d8…b73fea`; `src/infra/repository/vectorSources.ts` `f561909a…02b8bb`; `src/domain/vectorMaintenance.ts` `ac0cc5a1…0f0e7a`; `src/infra/external/vectorEmbedding.ts` `5e9ea8c5…8007b7`; `src/utils/vectorEmbedding.ts` `dab8b356…afd5a7`; `test/domain/vectorPdfPolicy.test.ts` `38fac3e3…c94cc6`; `test/utils/vectorPdf.runtime.test.ts` `07d8ab4a…c72cd9`; `test/utils/vectorEmbedding.test.ts` `c9937f3c…d50101`; `test/domain/bookmarkImportMetadata.test.ts` `0eccf8e9…b356fd`.

### Repairs made during this pass

1. `apps/api/test/domain/bookmarkImportMetadata.test.ts` mocked `@prisma/hyperdrive-client` without its `Prisma` export, which broke module loading after `MediaSnapshotService` gained the `VectorMaintenanceRepo` dependency. The test mock now supplies `Prisma.sql`; production code was not changed.
2. `mediaSnapshot.test.ts` and `mediaRecovery.test.ts` needed the `VectorMaintenanceRepo` double (`listContentOwners`/`findArticles`) for the new media-admission dependency. Those fixture updates were present in the working tree during this pass (not authored by this agent); the final files pass 68/68 together and are included in the 237-test focused result.
3. Lint found four Prettier errors in `podcast.ts` (three) and `youtubeArticle.ts` (one); repository Prettier fixed formatting only, confirmed by before/after diff. Lint then passed with 0 errors.
4. The obsolete visual-splitting Workerd test failed with `sources.pdfInputs(...) is not a function`; it was replaced by the policy runtime test above rather than deleted or skipped.

### Failures, gaps and not executed

- The earlier 2026-11-04 failure (50 MiB visual PDF memory 161 MiB > 128 MiB) is **superseded** by the approved policy: the new runtime test never reads a 50 MiB body and observed a 11.4 MiB combined inspector peak. The historical log/record is retained and not rewritten as a pass for the old contract.
- Real Jina, real Vectorize mutation visibility and real cloud indexes were not exercised; all provider responses here are local stubs. Actual deployed metadata filters and index readback remain parent/operator gates.
- The long live E2E (`v5-live-1793763478323-3ce4e3`), HTTP smoke and `test:integration:local` were not repeated this round by instruction; their earlier evidence is not extended by this pass.
- The non-PDF marker publication ambiguity from the media handoff (R2 success followed by pre-commit DB failure) remains a separate unresolved item; this pass does not test or repair it.
- The `> 8 MiB` text fallback makes no full-visual-modality claim and does not require page splitting; capacity, native filters, cloud readiness and package-version decisions remain with the parent.
- No security audit was performed; the requested unavailable security model remains a separate blocker.

## Recovered acceptance contract — 2026-11-04

This section restores the original acceptance scope after the parent incorrectly reduced the three parallel test assignments. It does not report new test passes. The latest instruction prioritizes basic ingestion, the operator script, article/Collection/user vectors and usable recommendations; it does not cancel previously requested business transitions or recommendation details. Security review is explicitly deferred and is not a gate for this acceptance phase. Bot work remains cancelled and daily-reading implementation/Demo remains deferred under the later instructions.

### Source of scope and supersession

The original human requests were recovered from session `session_54207c5d-6a97-4d73-b5ae-6c0619761b69`, `agents/main/wire.jsonl`:

- Lines 6616, 7070, 7285, 7785 and 8259: ten-article real new-model writes, business transitions, actual article/Collection recommendations, normal `pnpm api -- dev`, and the actual main worktree rather than mocks or a divergent worktree.
- Lines 5295, 6094, 8972 and 9155: whole-article-first preparation with estimated subdivision only when needed; three indexes; independent user article/Collection profiles; native metadata/filter contracts; per-user vectors for formerly shared originals without new business copies.
- Lines 12190, 12265, 12293, 12449, 13557 and 13659: generated artifacts through existing generators, normal DI, Repository SQL, Controller validation, no checkpoints or standalone internal refresh bypass, and explicit post-processing admission rather than base persistence dispatch.
- Line 13738: exact three ordinary actions; new/re-saves, PowerSync saves, subscriptions/cancellation, star/unstar, archive/unarchive and deletion; readable Workflow ordering.
- Lines 8550 and 9035: no speculative concurrency platform or compatibility for discarded unshipped code; Bot cancelled and daily-reading work later.
- Earlier assistant algorithm commitments around lines 8865 and 8890 are claims to reconcile against current code, not proof of implementation: distinguish preference aggregation, article relevance/freshness ranking, Collection member reranking and candidate diversity. Obsolete PostgreSQL accumulators/contribution ledgers and fused article/subscription profiles are NOT reinstated. RRF for deferred daily-reading selection is NOT a new requirement for current recommendation APIs.
- Latest current-session PDF instruction supersedes all-size visual PDF splitting: original bytes `<= 8_000_000` go unchanged in one PDF request; larger accepted PDFs use preceding extracted text without reading the original PDF body; 50 MiB upload acceptance remains.

### Three-lane ownership without deleting requirements

| ID | Lane | Required acceptance | Evidence needed to close |
| --- | --- | --- | --- |
| A01 | Ingestion/article | Ten selected articles processed with the new model and written to the actual test Vectorize index | Actual input IDs, model, native representative/chunk readback, dimensions/normalization and no false `written`/visibility equivalence |
| A02 | Ingestion/article | Whole text first, complete content, estimated/model-bound subdivision, selected images and approved PDF routing | No silent truncation; preserve text/image policy; exact PDF byte boundaries and existing extracted-text fallback |
| A03 | Ingestion/article | New save and existing-content re-save | Source commit precedes explicit maintenance; no premature pending-source embedding; no unnecessary source refetch |
| A04 | Ingestion/article | PowerSync save and its supported mutation paths | Same committed-state semantics through the actual local-first path, not only REST |
| A05 | Ingestion/article | Star/unstar and repeated refresh | Current weighted profile equals recomputation; repeated actions do not accumulate duplicate weight |
| A06 | Ingestion/article | Archive/unarchive | Neutral contribution and no archive-only maintenance dispatch |
| A07 | Ingestion/article | Trash, restore and permanent delete | Only the affected private identity changes; refreshed/deleted vectors and preference agree with current state |
| A08 | Ingestion/article | Formerly shared source owned by A/B | Independent vector IDs, no business/R2 source copies, and A's removal leaves B intact |
| A09 | Ingestion/article | Import, PDF, Fork and media completion | Each existing committed completion path enters maintenance; do not treat one route as evidence for all |
| A10 | Ingestion/article | Core failure/retry semantics | No successful empty/failed projection; capture and media publication failures classified honestly; no new coordination platform |
| B01 | Operator/actions | Article refresh takes `sr_user_bookmark.id` | Only its owner's article then article preference; pending/failed article cannot falsely complete the preference |
| B02 | Operator/actions | Collection refresh takes `sr_user_collection.id` | Reuses current eligible member vectors; does not rebuild articles or subscriber profiles as an endpoint side effect |
| B03 | Operator/actions | Subscription refresh takes the existing subscription record ID | Only its owner's Collection preference, from all current eligible subscriptions; exact inactive/missing behavior recorded |
| B04 | Operator/actions | Local enumeration with the ordinary authorized Reader actions | Read-only parameterized keyset pages; every eligible user relation retained; article then Collection then subscription stages |
| B05 | Operator/actions | Explicit scope, dry-run, cursor and bounded batch | No hidden full-history execution, checkpoint file, generic targets/receipt API or automatic recovery platform |
| B06 | Operator/actions | Early failure/pending does not suppress later selected rows | Actual result counts, incomplete IDs and nonzero final exit; do not invent a native visibility race to claim coverage |
| B07 | Operator/actions | Normal architecture/generation | Existing Controllers, Domain Service and DI; SQL in Repository; no Edge/internal-route bypass or hand-edited generated outputs |
| C01 | Collection/preferences | Collection aggregation from current eligible owner members | Expected aggregate compared with native stored vector; each article contributes once, independent of chunks/pages |
| C02 | Collection/preferences | User article and Collection preferences remain independent | Separate exact IDs/namespaces; saved/starred weights and active-subscription membership verified without mixing |
| C03 | Collection/preferences | Subscription, cancellation, re-subscription and expiry | Correct Collection-preference change, no unintended article-profile or Collection-member mutation; explicit gaps if a case cannot run |
| C04 | Collection/preferences | Full eligible history and empty profiles | More-than-one-page enumeration, no recent-N shortcut; missing/zero profiles report cold start or empty honestly |
| C05 | Recommendation | Real article retrieval and ranking | Native bounded filtered recall, relevance and current freshness contribution, candidate diversity/deduplication and concrete returned articles; nonempty HTTP 200 is insufficient |
| C06 | Recommendation | Real Collection retrieval and ranking | Overall Collection similarity plus current recent-member reranking; concrete returned Collections and members, not a centroid-only placeholder |
| C07 | Recommendation | Existing business exclusions | Saved articles, own/subscribed Collections excluded; subscribed Collections' unsaved eligible articles can still be recommended |
| C08 | Recommendation | Current publication/read eligibility | Private saves do not enter public recall; closed/revoked members are excluded from responses before asynchronous deletion finishes; this is functional correctness, not the deferred security audit |
| C09 | Recommendation | Native filters and deployed metadata contracts | Actual index fields/types and query filters, numeric private user scope where applicable; no full-corpus/client-side substitute |
| C10 | Recommendation | Recommended items are usable | Existing save/subscription actions work with returned identities, and resulting vectors/recommendation exclusions follow the committed action |

All lanes report each assigned ID as `passed-live`, `passed-local-only`, `failed`, `not-run` or `blocked`, with command/result/evidence path and reason. A completed local test is not automatically a completed live scenario. Parent owns the combined report and must account for every row; changing execution priority never silently removes a row.

### Current evidence and gaps, not completion claims

- Standard checks and PDF local/runtime results above remain evidence for their recorded code snapshot. The live 2-page Jina call, current HTTP/database smoke, bounded CLI calls and partial recommendation checks are retained in the session/tool logs and `.local/vector-live/` evidence; they require row-by-row mapping rather than one blanket completion mark.
- The test `youtubeArticlePublicationMarker.test.ts` currently reproduces a defect; its three passing assertions do not prove the recovery bug is fixed.
- Stale-vector deletion is already part of refresh: when an old article had more chunk IDs than its replacement, surplus old IDs are removed in `domain/vectorMaintenance.ts` before publishing the updated representative. This is not deletion of new results and not a separate cleanup service. Verify normal replacement correctness without inventing an additional platform or delaying the basic pipeline for speculative cleanup work.
- Parallel test batches interrupted by the user are not completed. Resume only with this full row allocation and isolated fixture ownership; do not copy the superseded reduced prompts.

### Parent-reviewed lane B interim result — 2026-11-04

Source evidence: `.local/vector-live/parallel-B-live-evidence.json`, `parallel-B-command-evidence.json`, `parallel-B-supplement.json`; execution `parallel-B-1793790267523`. This is bounded user-8 TEST-account execution, not production or full-history acceptance. The agent's headline `all rows passed-live` is NOT accepted for every subcase: the evidence itself records pending/failed-source, inactive-subscription and multi-subscription gaps.

- **B01:** Own relation 29 refreshed article `a:8:29` then `u:8:article`, with non-target write tokens unchanged. Pending/failed-source ordering has not been exercised live in this lane. The live relation/bookmark IDs both equal 29, so distinct-primary-key interpretation still needs explicit supporting evidence.
- **B02:** Collection 7 refreshed without article or user-profile side effects; its native vector matches the expected member aggregate (cosine 1.0000).
- **B03:** Subscription record 15 correctly refreshed `u:8:collection` from Collection 6 (cosine 1.0000; 1024 dimensions, unit norm, `user-collection` namespace), without modifying article preference or Collection vectors. Missing/invalid/unauthenticated requests were exercised. Inactive-owned records and aggregation across multiple active subscriptions were not exercised live by this lane.
- **B04:** `--user 8 --batch 2` enumerated and processed five article relations (29–33), Collection 7 and subscription 15 in that order: received 7, pending 0, failed 0, exit 0. Read-only database session rejection of UPDATE was recorded separately; no data change was claimed.
- **B05:** Dry-run yielded the same bounded pages with zero received operations and unchanged native write tokens. Explicit IDs/cursor selected only the expected later row; documented CLI path was exercised without checkpoint files.
- **B06:** Foreign row 25 was rejected, later own row 29 still completed, and the script returned `refresh_incomplete`/exit 1 with failed 1 and received 1. Foreign vectors were unchanged. This proves continuation after a real request failure, NOT a real native-visibility pending race.
- **B07:** Ordinary authenticated routes were exercised; generated-route/DI/internal-route architecture is supported by source inspection and 62 focused local tests, not represented as a separate cloud architecture test.

The same DeepSeek agent completed the follow-up. `vectorMaintenance.test.ts`, `vectorRefresh.test.ts` and `threeVectorRefreshActions.test.ts` passed together: 190 tests, exit 0. New `vectorRefreshPkAndContinuation.test.ts` passed 3 tests, exit 0. Filtered reruns are subsets, not additional unique test counts. Parent read the new assertions: relation 1 maps to bookmark 41, Collection 81 differs from subscription record 91, and an early pending row 11 does not suppress later row 21; the run remains incomplete and closes its DB client. These are controlled local mocks/PGlite evidence, NOT live provider race evidence.

Corrected mixed coverage: B01 has a live ordinary-success path plus local-only pending/failed ordering and distinct-ID behavior; B03 has live active/missing-record paths plus local-only inactive-owner and multi-subscription behavior; B06 has live authorization-failure continuation plus local-only pending continuation. Live own-source pending, inactive-owned subscription and multiple eligible subscriptions remain not run in lane B. B02/B04/B05 retain their bounded live results; B07 combines actual generated-route execution with inherently static/local architecture checks. Detailed subcase evidence is in `.local/vector-live/parallel-B-subcase-matrix.json` and `parallel-B-tests.log`. No further provider retries are requested merely to manufacture a visibility race.

Retained fixture: subscription 15 (user 8 to unchanged published Collection 6) was created through the normal subscription action and remains for parent-coordinated cleanup after all lanes finish. No new bookmark/Collection or shared source body was modified by lane B. A transient shared-dev outage and peer changes to `a:7:27` were observed; lane B reports stable per-action before/after windows, so cross-lane effects must still be considered during final consolidation. No task checkbox or overall completion state is advanced by this interim note.


## Live acceptance continuation — 2026-11-04 (test owner)

This pass continued from the preserved partial live evidence and reused the verified PDF size policy. Production code, generators, schema and dependencies were not changed; only local test/harness files and one test file were added. The live environment used the same local API/PG setup, the authorized test account `52bb95cdad45ee5441e67b3a1e9dce5b`, the three `reader-test-v5-*` indexes and the real Jina provider. Provider responses in automated tests remain local stubs; the live HTTP/provider/native checks below are real.

### Snapshot and standard checks

- Code snapshot: branch `fix/android-storage-path-alias`, HEAD `83534757`. No `src`/`script`/generated change occurred after the previous standard checks except repository-Prettier formatting already recorded; the live checks therefore used the same production snapshot.
- Final API suite after adding the publication-marker regression: **214 files passed / 14 skipped; 3,114 tests passed / 114 skipped (3,228 total)**.
- `pnpm api -- typecheck`, `lint` (0 errors), four dry-run builds and strict OpenSpec (92/92) were not rerun because the production/generated snapshot did not change; their last passing evidence remains valid. `git diff --check` passes.

### Scenario status

| Scenario | Status | Evidence / reason |
| --- | --- | --- |
| `test:http` (actual local Workerd + disposable PG/D1) | verified | status `passed`; migrations, auth/CORS/spoof rejection, bookmark add/list/delete, D1/fulltext, source share, diagnostics and privacy; vector maintenance admission count 3 with owner-specific deletion, admission-only (no model/Vectorize). Log `.local/vector-live/test-http-2026-11-04.log`. |
| `test:integration:local` | verified | 10 groups passed: Collection pagination, PostgreSQL/logs migrations, tag intersection/repo, lab repo, Collection triggers/telemetry logs, payment and account-revocation PostgreSQL. Log `.local/vector-live/test-integration-2026-11-04.log`. |
| Three HTTP actions (article, Collection, subscription) | verified | Run 1 exercised all three against the real test index; CLI `--kind` calls below also hit each generated route. |
| CLI real bounded enumeration + calls | verified | Dry-run enumerated article IDs 34–38. Explicit article `--ids 34,36`: 2 received / 0 failed / exit 0. Full user-9 article page: 5 received / 1 failed (`source_not_ready` for the known pending relation 35). Collection user 7: 1/0. Subscription user 9: 1/0. |
| New save end to end | verified | Run 1: `/v1/bookmark/add` committed source; `/v1/bookmark/content` returned 200; native `a:9:38` written; maintenance workflow instance complete with article-write/visible, article-preference-write/visible and owner-collections all successful. The harness had timed out only because it matched unprefixed step names; direct instance inspection confirmed completion. |
| Existing-save initial refresh | verified | 10 ordinary relations refreshed; pending source returned explicit `source_not_ready` without preference refresh; all other actions written. |
| A/B shared original | verified | `sharedOriginalIndependentVectors` (distinct `a:7:24`/`a:9:24`, cosine > 0.9999) and `sharedOriginalNoBusinessCopies` (no source row/byte change). |
| Recommendations + current-state filtering | verified | Run 1 `meaningfulRecommendations` passed: saved items excluded, own/subscribed Collections excluded, public starred membership and source URLs admitted. |
| Publication / revocation | verified | Standalone: article 27 (owner 7) present in 9 recommendations, unstar committed in DB and excluded it (8), restar restored it (9); star/archive flags restored. |
| Subscriptions | verified | Run 1: subscribe/cancel, independent article/Collection profiles, subscription-ID aggregation across all active subscriptions, inactive/missing-record denial. |
| Star/unstar weights | not run (blocked) | Business star commit observed via revocation, but the user-9 article-preference weight/idempotence scenario failed environment preconditions: the fixture reached 27 article vectors and the real native `getByIds` call failed (see product bug 1). |
| Archive/unarchive neutrality | verified | Two archive toggles committed; zero maintenance instances targeting `(9,24)` were created; archive/star state restored (`relation 34: starred=true, archive_status=1`). |
| Trash / restore | failed (product bug) | `POST /v1/bookmark/trash` for bookmark 24 returned HTTP 400/code 500 before committing `deleted_at`; see product bug 2. Restore was therefore not reachable. |
| Permanent delete | verified for a created PDF | `/v1/bookmark/del` removed the created 12-page PDF relation and its vectors; the shared fixture save was intentionally not permanently deleted. |
| Direct PDF supplier | verified | Real Jina 2-page PDF: HTTP 200, model `jina-embeddings-v5-omni-small`, 2 items, 1024 dimensions, 1,165 source bytes. |
| 12-page PDF direct path and >10 chunk cleanup | partial | Created bookmark 39: native representative `a:9:39` had `part_count: 12` and `text_key: ""` (direct-PDF branch, no extracted text). All 12 chunk IDs were observed and later absent after deletion; the representative disappeared after the deletion workflow. Not a single clean harness pass because the dev session was terminated mid-scenario. |
| Fork / PowerSync save / Pinboard import / extended PDF upload | not run (blocked) | The `--extended` monolithic run could not pass preflight because concurrent agents were creating foreign rows in users 7/8/9 (see blocker). |
| Existing-content re-save | not run (blocked) | Same blocked `--extended` prerequisite. |
| Media completion (YouTube/podcast) | not run | No media fixture belongs to users 7–9; `sr_youtube_article_ref`/`sr_podcast_episode` rows belong to user 1/bookmark 23. Creating a new external media source would exceed the authorized fixture and requires external ingestion. |
| Security audit | not run | The requested security model is unavailable; no substitute audit was performed. |

### Product bugs found (not fixed)

1. **Native `getByIds` limit is 20, but the service batches 100.**
   - Observed real error: `VECTOR_GET_ERROR (code = 40007): too many ids in payload; max id count is 20, got 27` (also observed with 22) during `refreshUser` aggregate; the HTTP action then returns a failed domain result and the maintenance workflow retries.
   - Path: `apps/api/src/domain/vectorMaintenance.ts:47` (`VECTOR_READ_BATCH_SIZE = 100`) used by `get()` at lines 161–171 → `AiEntry.v5GetByIds` → Vectorize.
   - Minimal repro: a user with more than 20 article vectors, then `POST /v1/bookmark/vector/refresh` (article preference aggregation) or `/v1/collection/preference/refresh`; the native batch exceeds 20.
   - Impact: user preference refresh, deletion verification and other exact-ID reads fail for users with >20 vectors. This is independent of the PDF change.
2. **Trash fails when the user has no `sr_bookmark_share` row.**
   - Observed: `POST /v1/bookmark/trash` for bookmark 24 as user 9 (no share row) returns HTTP 400/code 500 with `PrismaClientKnownRequestError` `P2025`: `sr_bookmark_share.update()` found no record; `deleted_at` stays null.
   - Path: `apps/api/src/domain/bookmark.ts:492` (`trashBookmark`) → `apps/api/src/infra/repository/dbBookmark.ts:667-672` (`updateBookmarkShareIsEnable` uses `update` rather than an idempotent `updateMany`/upsert or a missing-row guard).
   - Impact: trash/restore is impossible for saves without an explicit share row; the required trash/restore scenario is blocked by this product defect. `del` works because it handles missing rows.

### Blocker: concurrent harnesses and shared fixture

Despite the dispatch premise of zero other tasks, agents 489/490/491 were active in the same session/worktree and ran `parallel-A-acceptance.ts`, `parallel-B-live.ts` and a native probe against the same users 7/8/9. Their rows appeared continuously: relation count moved 18 → 40 → 29 during this pass, with foreign rows 53, 65–76 (`http://localhost:3000/...` and `https://example.com/parallel-A-...`). The fixture preflight correctly rejected them (`fixture_relation_budget`, then `foreign_fixture_url`); deleting or mutating another agent's fixtures was not authorized. The shared `pnpm api -- dev` singleton was also restarted/killed by that activity (exit 143), interrupting runs. A clean monolithic `--execute --extended` run requires the parent to stop/coordinate those agents, remove or authorize cleanup of their abandoned rows, and then rerun; the harness and step-name fix are ready.

### Harness fixes made

- Accept workflow step names with attempt suffixes (`article-write-1`, …) instead of only unprefixed names; this was the sole cause of the run-1 `timeout_workflow_newSave...` after the workflow had completed.
- Bounded retries for the committed-source read, native `get-vectors` CLI failures, and domain `failed` results from the three refresh actions; persistent failures still fail.
- No assertion was weakened to accept a missing vector, stale profile or skipped cleanup. `.local/vector-live/main.ts` and the targeted standalone scripts are local harness files, not production code.

### Preserved evidence

- Failed/interrupted harness evidence: `.local/vector-live/v5-live-1793763478323-3ce4e3/evidence-failed-three-actions-1793787909017-65e190e3.json`, `…-1793789074210-8c08d691.json`, `evidence-interrupted-three-actions-1793789353103-678e3b41.json`, `evidence-preflight-blocked-three-actions-1793790090584-a1f3213e.json`.
- Logs: `.local/vector-live/live-extended2-failed.log`, `chunks3-dev-interrupted.log`, `chunks4-preflight-blocked.log`, `dev-accept3-evidence.log` (contains the real 20-ID and P2025 errors), `test-http-2026-11-04.log`, `test-integration-2026-11-04.log`.
- Machine-readable milestone summary: `.local/vector-live/live-milestone-2026-11-04.json`.

### Fixture state at this handoff

- Bookmark 38 / relation 39 (the run-1 new save) remains as a successful test row; it was not deleted while other agents were actively using user 9's profile.
- The `pdf` lab feature was enabled for user 9 through `POST /v1/user/setting/enable` (`lab:pdf`) because the fixture had no lab row; it should be restored after the concurrent agents finish. No direct database mutation was used.
- Rows 53 and 65+ and the `parallel-A`/`parallel-B` rows belong to concurrent agents and were not modified or deleted.
- A detached local dev session was started by this pass and left running for the other active agents; it is not a production service.

## Parent-reviewed lane C result — 2026-11-04

Evidence: `.local/vector-live/parallel-C-collection-recommendation.json` and `parallel-C-*.ts` probes; final recommendation-only rerun exited 0. Earlier lane runs exited 1 and remain preserved. The lane's blanket description of all non-C09 rows as live-passed is qualified below because several required subcases remain local-only, blocked or not run. No overall feature-completion checkbox is advanced.

### Verified live behavior

- Collection 6 matches the normalized aggregate of eligible owner-member representatives (`a:7:24..28`, cosine 1.0); Collection 7 independently matches its own members. Ordinary refresh leaves unrelated vectors/profiles unchanged.
- User 7's article profile matches current saved/starred weights (1/2), not an all-starred or chunk-multiplied alternative. A private 12-page PDF contributes once despite 12 chunks. Article and Collection preferences retain separate IDs/namespaces.
- Subscribe/cancel/re-subscribe to Collection 7 creates/removes/restores user 7's Collection preference, with complete subscription-only Workflow steps and unchanged article profile/Collection aggregates. Empty Collection preference returns explicit cold start.
- Article results `8:30`, `8:32`, `8:29` were reconstructed from current stored vectors and UTC publication times. The implementation's 0.08 freshness weight and 30-day half-life matched returned scores to approximately `3.5e-8`; MMR order and limit-prefix behavior matched. This verifies this implementation's scoring, not a trained research-model implementation or general recommendation-quality benchmark.
- Positive Collection recommendation was checked by a read-only user-9 request: Collection 6 score `0.6820892500413668` equals `0.75 * 0.6916105 + 0.25 * 0.6535255`; recent members 27/28/26 and their per-member similarities matched. User 7's own/subscribed-only fixture legitimately yields no public Collection candidates.
- Saved articles and own/subscribed Collections are excluded; unsaved articles from a subscribed Collection remain eligible. Private PDF vectors are absent from public filtered recall and responses.
- Saving a returned article through the normal action created relation 98/bookmark 97 and private `a:7:97`, recomputed the user's article preference and excluded the source recommendation by identity/URL without modifying the source owner's save. The ordinary subscription action also removed that Collection from new-subscription suggestions.

### Required subcases still open

- C01 multi-chunk Collection member (not merely a user-profile member): blocked by shared published baseline fixture ownership.
- C03 actual subscription expiry: not run; ordinary cancellation is not equivalent to expiry.
- C04 aggregate paging beyond 100 rows: local 103-row coverage only; live fixture has seven eligible identities. CLI batch-one pagination does not establish aggregate-service multi-page behavior.
- C05 controlled freshness ordering and live public chunk duplication: not run; reconstructing existing scores does not prove every counterfactual ranking case.
- C08 revocation before asynchronous removal: not repeated within lane C because shared-baseline mutation would interfere with peers. Retained earlier live revocation evidence and local revocation tests require exact fixture/snapshot reconciliation by the parent.
- C09 range-filter anomaly, **attribution corrected after read-only follow-up**: the installed `wrangler@4.127.1` CLI's `validateQueryFilter` allowlist contains `gte` rather than `$gte` (`wrangler-dist/cli.js:470885`). Consequently the CLI omits the requested `$gte` field before HTTP submission. Parent independently read this code. Fresh stable user-8 metadata and 13 bounded query controls reproduced the issue even at `topK=50` with metadata and `topK=100` without metadata; `$gt`, `$lt`, `$lte` and equality controls constrained correctly. The earlier claim that Vectorize or the application ignores `$gte` is withdrawn. The application's direct binding query does not use this CLI validator; optional `since` remains unverified at the application-binding layer, not a demonstrated product defect. Current recommendation routes do not pass `since`; their actual equality filters and deployed metadata definitions retain live evidence. No epsilon workaround, removal of `since`, dependency update or production change was made. Evidence `.local/vector-live/parallel-C-gte-followup.json` supersedes only the C09 failure attribution in the preserved original lane file. Other incomplete C subcases remain open.

### Retained fixture ownership

Lane C retained own user-7 relations/bookmarks 76/75, 78/77, 93/92 and 98/97, plus active subscription 18 to Collection 7; subscription 17 was cancelled. These are test-only fixtures for parent-coordinated cleanup after other lanes finish. It also refreshed article 27 to repair preexisting metadata inconsistent with current starred state; this overlaps a baseline referenced by peers and must be considered when comparing cross-lane snapshots. Shared source-body digests and Collection aggregate values were reported unchanged. No security audit was performed, and it is explicitly deferred by the user, not a gate for this functional testing phase.

## Parent-reviewed lane A result and core fixes — 2026-11-04

Evidence: `.local/vector-live/parallel-A-evidence.json`, execution `parallel-A-1793790814773-cb91bb77`, `/tmp/parallel-A-acceptance.log`, and its cleanup record. The harness exited 0 while recording `failed-with-row-statuses`; the process exit therefore does NOT mean acceptance passed. All original row outcomes remain in scope.

| Row | Reviewed evidence status | Outcome |
| --- | --- | --- |
| A01 | passed-live for ten article writes | Ten fresh Jina v5 representatives (bookmarks 78–86 and 88) were read from test Vectorize with expected private identity, dimensions, normalization, metadata and committed-source Workflow order. This does not establish reliable user-profile refresh above 20 articles. |
| A02 | mixed live/local | 131,159-character text produced two native parts; a 1,241-byte PDF followed direct processing; an 8,103,705-byte PDF used extracted text without original GET. Exact thresholds and image selection were local-only evidence. |
| A03 | passed-live | Existing-content re-save reused bookmark 78 without source refetch or hash change and admitted maintenance after source commit. |
| A04 | failed | PowerSync Reader-link save produced failed bookmark 103; snapshot readiness blocked completion, and subsequent local-first star/archive checks were not reached. |
| A05 | failed | Starred-profile comparison did not converge; after unstar/reset and explicit refresh, stored profile still differed from exact current aggregate. Stale Workflow overwrite is an agent hypothesis, NOT established causality. Recheck after the native read-batch defect is fixed with exact current membership/vector/write-token evidence. |
| A06 | passed-live | Archive/unarchive changed business status only, with unchanged profile and no article-maintenance dispatch. |
| A07 | failed/partial | Trash failed on absent share-row P2025; restore was unreachable. Permanent deletion of an own test item removed its private vectors and recomputed preference. |
| A08 | blocked/partial | Independent A/B vectors and unchanged shared originals were observed. A-only removal/restore was blocked by the same trash failure, not proven by read-only identity checks. |
| A09 | blocked/partial | Import accepted then failed `fork_source_not_ready`; REST Fork timed out. Approved PDF branches passed. Actual YouTube/podcast completion was not run; media local tests do not substitute. |
| A10 | passed-live for source-not-ready case only | Known pending relation 35 returned explicit `source_not_ready` with no preference/vector/maintenance side effect. The separate publication-marker recovery defect remains unresolved. |

### Narrow core repairs now implemented, not yet accepted

1. The deployed test binding rejected native get requests containing more than 20 IDs (code 40007, request 27). `domain/vectorMaintenance.ts` now separates `VECTOR_GET_BATCH_SIZE = 20` from existing 100-item DB/write/delete paging and applies it to shared get and both native verification loops. No history truncation, query-limit change or new retry/coordination layer was added. The bound is based on observed deployment behavior, not asserted as a universal vendor limit.
2. `infra/repository/dbBookmark.ts:updateBookmarkShareIsEnable` keeps the existing update/record return, but disabling an absent row (`P2025`) now returns null. Enabling errors and all other database failures still propagate; no public share is created. Production callers were inspected and ignore the disable return value.

The parent read both fixes. DeepSeek owns targeted local and real >20-history, trash/restore, isolation and exact weighted-profile regressions. Earlier green suite/build evidence predates these changes and is not promoted to final-version acceptance. A separate read-only investigation classifies Fork snapshot failure and media publication-marker recovery before any broader fix; no speculative lock/platform or fixture-state deletion is authorized.

### Fixture caution

Lane A reports deleting its claimed failed-run duplicates to reduce the eligible count below the provider read limit. Those deletes are NOT the product fix and do not establish >20-history support. It retained own articles 78–86 and PDFs 89/93/94/98/99/101/102 and preserved shared sources 24–33, other-user rows and subscription 14. Further verification must retain every eligible identity and prove the fixed batching path rather than shrinking data to evade the defect.

### A04/A09 diagnosis corrected after source/spec review

The earlier table preserves observed harness failures, but its implied common Fork/R2 product diagnosis is withdrawn:

- **A04:** Queued PowerSync Reader URLs intentionally create a terminal failed placeholder without copying/crawling under `add-bookmark-fork/specs/bookmark-fork/spec.md:133-147` and `dbSyncBatch.ts:191-224`. The A harness asserted success for this compatibility path; it did not test ordinary external-URL PowerSync ingestion. Correct acceptance must test external-URL save success separately, retain Reader compatibility failure/replay as expected behavior, and verify unrelated sync mutations still succeed.
- **A09:** The harness selected user 9's own Reader links, then waited for a newly allocated relation/different bookmark. Existing `bookmark-fork` spec lines 61-63 requires returning the same item. Both own-source service entry points return before `copyHtml`. Own-link import should attach that existing item to the import task, not create another personal save. Consequently a new-relation polling timeout is not evidence of an HTTP copy failure.
- The ambient `fork_source_not_ready` import log is not yet correlated to those exact final requests. `snapshotBundle.ts:63` rejects missing HEAD; conditional GET/body and tracked-ETag mismatch are distinct checks on following lines. Historical markdown-only fixture sources provide a plausible valid rejection, not proof of conditional-R2 malfunction.
- DeepSeek is correcting A04/A09 test expectations and preparing separate authorized cross-owner HTML-backed Fork/import cases. Conditional GET, tracked ETags, final revision/access validation and ordinary retry semantics remain unchanged; no unconditional-read fallback, HTML synthesis, source-pointer rewrite or fixture deletion is approved.

### Confirmed media publication recovery defect

The executed local three-test reproduction plus source review established a real gap in the earlier source snapshot: required text/HTML writes could succeed before DB publication failed; `releaseWrite` then restored success without publishing content fields; marker-based retry could skip publication. Live PostgreSQL/R2 reproduction was not established. After the exclusive core regression finished, the coordinated repair was implemented only in mediaBody.ts, mediaSnapshot.ts, youtubeArticle.ts and podcast.ts: revision-guarded failure after attempted writes, failed-state cached republication, committed-state marker/status checks and preserved uncertain/newer commits. No new schema, lock or coordination platform was added. DeepSeek now owns failure-injection/media/full-check verification; this implementation is NOT yet accepted, and the former green suite cannot be treated as evidence for the new four-file patch.

## Core repair regression accepted — subsequent media patch excluded

Source: `.local/vector-live/repair-core-evidence.json` final state `passed`, repair-core live/fulltest/typecheck/lint logs, DeepSeek agent490 handoff. No fixture truncation was used in this repaired run.

- **Native >20-history repair:** 27 eligible user9 saves were retained/created through ordinary actions. Relation112/bookmark111 refresh returned article and preference `written`; native user preference matched the complete 27-member weighted aggregate (cosine `0.9999999998`, observed after about45s). Local21/27/41/103-ID tests cover all get/verification batches <=20, with complete history and no empty extra calls.
- **A05 weighted changes:** star on relation109/bookmark108 changed the stored profile token and matched weight2 (cosine effectively1, observed about119s). Repeating star did not double weight. Unstar matched current weight1 (cosine `0.999999999`, about150s); corresponding Workflow visibility steps subsequently completed. Stale overwrites were NOT reproduced after the batch repair, so the earlier concurrency explanation is not a confirmed root cause.
- **A07/A08 private trash/restore:** ordinary trash succeeded without a share row, removed `a:9:24` and matched the26-member profile after about131s. Restore returned the relation/vector and expected profile after about91s. `a:7:24`, user7 profile and shared source fields remained unchanged. This closes the prior absent-share blocking path and that A/B removal scenario for the tested snapshot.
- **Local checks:** 97 focused tests passed; 15 filtered cases are a subset, not extra unique tests. Full suite:216files passed/14skipped,3140tests passed/114skipped, exit0. Typecheck/lint exit0; lint343warnings and0errors. These results precede the new four-file media recovery patch.
- The initial core harness itself sent >20 read IDs and used too-loose `1e-3` profile tolerance. Its final run batches reads and uses `1e-5`, smaller than the observed star delta; the final evidence supersedes those initial attempts, which are not product failures.
- Retained new own fixtures104–111 and relations105–112 remain for coordinated cleanup. Relation34/bookmark24 is restored/live/starred with vector present. No previous A/B/C fixtures or another user's rows were deleted by this verification pass.

Corrected A04/A09 local harness proof and109 focused tests are complete; targeted live execution now runs separately from media local checks. It must reuse own snapshots, distinguish queued Reader compatibility from external PowerSync success, and use authorized HTML-backed cross-owner sources. No cleanup-to-20 prerequisite remains.

## Final media and recommendation verification details after restart

- Media recovery:4files/93tests and combined11files/314tests passed. Corrected tests cover attempted/partial object writes, DB throw/false, cached failed-row repair, managed terminal manifests, source/owner guards, uncertain committed acknowledgements, status readiness and independent post-commit cleanup. No tests were weakened to pretend fixed objects were rolled back.
- Runtime recovery: `test/infra/mediaPublicationRecovery.integration.test.ts` passed3/3 against a real disposable PostgreSQL17 instance and actual revision primitives. R2 was the existing in-memory `memoryBucket`; provider generation and Workflow admission were explicit stubs. This proves the real DB failure/recovery boundary, NOT a live cloud-media provider acquisition. The owned container/workspace was removed.
- Standard isolated integration passed10groups. Final default suite at that checkpoint:216filespassed/15skipped,3167testspassed/117skipped; newly environment-gated integration cases are skipped by default but separately executed. Typecheck/lint(0errors)/strictOpenSpec92/0/diffcheck passed. Four-Worker build used an isolated generated output and public template, left running dev config unchanged, and exited0.
- Separate Fork PostgreSQL suite initially had4failed/35passed. Fast traced the four failures to stale setup: successful re-save now intentionally reuses status/revision, whereas tests assumed `createBookmark(...,'pending')` reopened it. The planned TEST-ONLY correction explicitly seeds a newer pending/pending_retry revision in the disposable DB, preserving all guarded-claim, stale-moderation, revocation and publish/fail assertions. No production behavior change or broadening claim-to-success is approved. Rerun evidence is required before marking that gate passed.
- Recommendation supplement:10 new local tests across `contentRecommendation.test.ts` and `vectorMaintenancePublication.test.ts`,2files/52tests pass. Actual production Repository SQL runs on disposable PGlite for expiry/re-activation and Collection eligibility; native vectors remain stubs. Tests cover one contribution per multi-chunk member, expiry-only Collection preference updates, cold start, controlled30-day freshness ordering, MMR diversity, same-identity deduplication, recent-member reranking and revocation during hydration. Seven reused paging/filter cases pass; those are subsets, not extra full-suite totals.
- Optional native `since` is only verified for exact application filter forwarding in a local test. Earlier CLI `$gte` failure attribution remains corrected; no product workaround or dependency upgrade was introduced. Live controlled expiry, >100-history and counterfactual ranking cases remain explicitly local-only, while previous actual recommendation score/candidate/action evidence is retained.

Evidence files: `.local/vector-live/repair-media-status.json`, `repair-media-runtime-status.json`, `repair-media-runtime.log`, `repair-media-integration-standard.log`, `repair-media-full-suite-final.log`, `repair-media-build.log`, `parallel-C-final-subcases.json` and corresponding focused logs. Final acceptance is not claimed while the corrected Fork rerun and targeted live A04/A09 remain pending.

## Bounded capacity and metadata snapshot — 2026-11-04

Read-only evidence: `.local/vector-live/capacity-index-evidence.json`, DB snapshot `2026-11-04T14:34:19.812Z`, authorized test users7/8/9 only. This is a point-in-time test dataset while user9 ingestion continued, not a production sizing promise.

- 51 relation/pair records contained 45 eligible user-save pairs, compared with 44 distinct underlying bookmark IDs and 39 target URLs. Capacity is based on the 45 user-save identities, not canonical URL deduplication.
- Per-pair article records are `1` when `part_count=1`, otherwise `1+part_count` (representative plus chunks). The snapshot had 40 single-part, 4 two-part and 1 twelve-part pair: 45 representatives + 20 chunks = 65 expected article records. All 65 expected IDs were read natively; no expected representative/chunk was missing.
- Six ineligible pairs were checked for representatives and none remained; old chunks for those identities were not exhaustively scanned. The article index metric reported 67 objects, leaving 2 unattributed objects; they are NOT asserted stale, absent, or storage bytes.
- Two Collection vectors and six exact-ID user preference vectors were present. Article/Collection default namespaces and `user-article`/`user-collection` preference namespaces matched the current contract. Index dimensions were 1024.
- Actual article filter indexes include String `kind`, Number `user_id`, Bool `recommendable`, Number `published_at`; Collection has `recommendable` and `published_at` (plus an existing `kind` index); user index has no metadata indexes. Existing legacy generation/recipe/recipe_digest indexes remain recorded, not used to reintroduce cancelled configuration and not silently removed. Return-only identity, part-count, source fingerprint and write-token fields are identified in the JSON contract.
- Production eligible history, headroom, provider object/byte caps and total storage bytes were not queried or guessed. Deployment/full-history/production-capacity approval remains a human release gate; no provisioning, monitoring, index cleanup or production access occurred.

## External reference cases and public click-data pilot — 2026-11-04

Requested by the human after functional acceptance: evaluate examples from other recommendation projects and run one bounded effect comparison. Tests were executed by DeepSeek; production ranking code/weights, packages, database/index contents and services were not changed.

### Reproducible public references

- Recommenders evaluation tests/fixtures/metric implementation, source commit `51c7f64b4b8ed90e7f734bca21f3f8c55f035430`, MIT. Source paths, URLs, SHA-256 and adapted case definitions are in `.local/recommendation-external/reference-sources.json`. MIND official `evaluate.py` is an algorithm reference with its own pinned source/hash; no unlicensed upstream code was copied.
- The reference runner passed 12 external golden cases plus 8 bounded cases against the real `ContentRecommendationService`: 20/20, exit 0. New project test `apps/api/test/domain/contentRecommendationExternalCases.test.ts` covers local ranking behavior; it does not establish online quality. A conflicting upstream threshold assertion was explicitly excluded and documented, not silently claimed passed.
- MINDdemo train/dev archives were obtained from the Recommenders dataset mirror with content hashes and license evidence retained locally. Use was restricted to local research/testing; data is not redistributed or integrated into the application. Raw public article text is not reproduced in this report.

### Frozen pilot protocol

Seed `20261104`; 60 distinct users/impressions selected deterministically before scoring, with 2,042 total candidates, 91 clicked positives, 2,097 history entries and 1,945 unique title+abstract texts. All provided history/candidates are retained for evaluation. One empty-history record was excluded; no missing news metadata occurred. Popularity uses training clicks strictly before the earliest selected development impression; test labels are used only for eligibility and metrics, never ranking features or tuning.

The initial run made 61 actual Jina API batches for `jina-embeddings-v5-omni-small`, returning 1,945 normalized 1024-dimensional vectors. Later runs use the frozen cache with zero provider calls. MIND click history is not saved/starred data, so all history weights are 1. News records lack publication timestamps: freshness is deliberately equal for every candidate, not inferred from impression time. These title+abstract inputs are not equivalent to full Reader text/media.

The first raw-cosine/MMR approximation is retained in `mind-results.json`. It is NOT the final product result. The audited rerun imports the actual `ContentRecommendationService.articles` and uses local data/vector adapters to honor candidateLimit100, rerankLimit50, score `0.92*cosine + 0.08*equal freshness` and production MMR. The full supplied candidate pool remains in metric denominators; 3 impressions exceed the candidateLimit and receive its real cutoff. This is actual service ranking logic, not ANN/authorization/repository/cloud end-to-end evaluation. Sample/cache hashes remain unchanged; 7 audit checks pass.

### Measured results

| Method | nDCG@5 | nDCG@10 | Recall@10 |
| --- | ---: | ---: | ---: |
| Random, mean of 20 fixed seeds | 0.2143 | 0.2823 | 0.5356 |
| Training popularity | 0.2756 | 0.3251 | 0.6075 |
| Mean-history embedding + pure cosine | 0.2888 | 0.3281 | 0.5478 |
| Actual ContentRecommendationService, equal freshness | 0.2855 | 0.3397 | 0.5976 |

Official MIND-style metrics are impression-macro; its MRR averages reciprocal ranks over all positives. Full-rank AUC/MRR are reported for random/popularity/cosine only; the service returns top10, so its AUC/MRR are deliberately not fabricated. Training popularity AUC is0.5815 versus cosine0.5550; cosine MRR is0.2636 versus popularity0.2439.

Paired bootstrap over the 60 one-user impressions, 1,000 resamples: service-minus-popularity nDCG@10 delta `+0.0146`, 95% interval `[-0.0822,+0.1191]`; Recall@10 delta `-0.0099`, interval `[-0.1443,+0.1167]`. Service-minus-random nDCG@10 delta `+0.0575`, interval `[-0.0136,+0.1333]`; service-minus-cosine `+0.0117`, interval `[-0.0123,+0.0369]`. All these intervals include zero.

**Conclusion:** functional ranking correctness passed reference tests, but this pilot does not demonstrate a statistically reliable quality improvement over popularity or cosine. Popularity's Recall@10 is slightly higher. The current algorithm may be evaluated further; no weights were tuned to these labels and no favorable-only result was selected. This pilot does not prove generalization, online lift, full-text/freshness effectiveness, ANN/filter behavior or Collection/subscription quality (MIND provides no Collection ground truth).

Evidence: `.local/recommendation-external/reference-results.json`, `reference-sources.json`, `mind/sample-manifest.json`, `mind/embeddings-cache.json`, `mind-results.json` (historical approximation), `mind-service-results.json` (authoritative actual-service pilot), and reproducible `mind/prepare.ts`, `mind/pilot.ts`, `mind/service-audit.ts` with logs. No production deployment, data mutation, dependency installation or recommendation-weight change occurred.

## Multi-direction recommendation acceptance — 2026-11-05

The human asked to finish multiple directions rather than treating the article-only MIND comparison as the entire recommendation test plan. Three DeepSeek lanes executed the current production methods against controlled expected values and two public-data experiments. Correctness conformance is the primary verdict; baseline superiority is a separate descriptive measurement, not a substituted pass criterion. Production code and weights were not changed.

### Expected-output acceptance by direction

| Direction | Executed expectation | Reviewed outcome |
| --- | --- | --- |
| User article preference | Equal saved history, saved=1/starred=2, idempotent repeat, archive neutrality, deletion/restoration, complete 103-identity paging and representative-only contribution | Nine controlled actual-`VectorMaintenanceService` cases pass; maximum component error below 1e-16 versus independent arithmetic, 103 unique representatives across six bounded native-read adapter calls. Public MIND vectors were reused; synthetic star/archive states are not represented as observed MIND behavior. |
| Article recommendation | Actual profile-to-service ranking, cold start, identity deduplication, supplied exclusions, exact relevance/freshness formula, production MMR diversity and maintenance-to-ranker linkage | Seven controlled actual-service/production-primitive cases pass. These include explicit expected ordering, not merely a nonempty response. |
| Collection aggregation | Each full member contributes once despite chunks or duplicate relations; remove/replace/empty behavior; A/B owner isolation | Six controlled PGlite/native-stub cases pass. Public item-vector runs additionally compare every aggregate with its independent expected normalized sum. |
| User Collection preference | Subscribe one/two Collections, cancel, re-subscribe, expiry/own-Collection exclusion, empty state, idempotence and independence from article profile/Collection vectors | Eight controlled cases pass. Expected one-hot/two-axis values are independently calculated; no real-user subscription labels are fabricated. |
| Collection ranking and recommendation feedback | 0.75 overall + 0.25 member reranking can reverse native order; MMR diversity; subscribed-source cross-use; cold start; current revocation; action-to-profile-to-next-feed behavior | Six controlled cases pass, including exact expected IDs/scores and resulting exclusions. |
| Public Collection data through production methods | Complete member aggregation, historical Collection-profile composition, controlled member removal/restore, cold start and candidate/history exclusions | Five additional data-backed functional checks pass on the strict public cohort, with actual services and local adapters; no native Vectorize mutation. |

Counting: article audit contains **16 functional cases** plus **3 measurement/protocol rows**, not 19 functional passes. `recommendationMultiDirectionContracts.test.ts` adds **20** distinct controlled cases (6 aggregation + 8 subscription/profile + 6 ranking/feedback). The public Collection run has **5 functional checks** plus separately labelled protocol checks. These group totals are not added to the regression count as if independent test runs created new cases.

Final targeted regression: `recommendationMultiDirectionContracts.test.ts` (20) + previous-round `contentRecommendationExternalCases.test.ts` (8) + existing `contentRecommendation.test.ts` (34) = **62 passed**, exit 0. API typecheck/lint and tracked diff whitespace checks exit 0; lint reports 0 errors/343 warnings. No full-suite or deployment is claimed for this test-only round. Production file hashes match the article audit snapshot.

### Public article experiment (retained, not relabelled)

The frozen MIND 60-user/title+abstract evaluation remains: actual article service nDCG@10 0.3397, Recall@10 0.5976; pure cosine 0.3281/0.5478; popularity 0.3251/0.6075. Mean intra-list distance increased from 0.3600 for cosine to 0.3663 for the service. This is evidence that the frozen experiment ran and reports the relevance/diversity tradeoff; it is not a functional assertion that all ranking metrics must improve. MIND has no observed Reader star/subscription or publication-time labels for those product behaviors.

### Public Collection analogue and protocol correction

The usable public source is `BundleRec/bundle_recommendation`, resolved commit `087da2e2b4d8738ef23f3f6f2005505e8685edde`; fetched CSV/README content SHA-256 values are retained. Its README describes crowdsourced product bundles with session/item/user associations. These commerce bundles are an analogue, not article Collections, and interactions are not asserted to be subscriptions or confirmed purchases. No repository license was found; public availability is not a blanket reuse license. Downloaded content stays local/gitignored and is not redistributed. Earlier unavailable repository/ZIP references originated in the parent prompt, not the user's request.

The first 50-user experiment is retained only as exploratory retrieval: 49 users had target/history session overlap, and 54/66 history events shared the target timestamp. Its high nDCG and weak globally-excluded-positive popularity baseline are NOT accepted as next-event quality evidence. `collection-audit.json` records that rejection. Functional service assertions from that run remain separately reproducible.

A new strict protocol was frozen before embeddings/scoring: scan all 879 downloaded users; retain only histories strictly earlier than the target and disjoint from its session. **29 users** qualify, without performance-based replacement. A hash-selected negative catalogue is filtered to bundles observed before each target; the target is explicitly added and history excluded. This is sampled ranking, not full-catalogue evaluation. Per-user candidate counts are 24–94; all 608 item titles and complete multi-item bundle memberships are retained. The run reused 89 vectors and embedded 519 additional titles in 17 Jina batches. No weights were tuned.

Actual production `refreshCollection`, `refreshUser(..., 'collection')` and `ContentRecommendationService.collections` ran through local typed adapters. The 197 Collection aggregates and 29 user profiles matched independent normalized sums; the five functional checks passed. Member order is stable file order because actual publication times are absent; recentness effectiveness is not assessed.

| Strict public Collection experiment | nDCG@5 | nDCG@10 | Recall@10 |
| --- | ---: | ---: | ---: |
| Random, 20 fixed seeds | 0.0580 | 0.0905 | 0.1983 |
| Pure Collection centroid | 0.2027 | 0.2368 | 0.3793 |
| Actual member-rerank/MMR service | 0.2324 | 0.2424 | 0.4138 |

For this 29-user sample the service retrieved the held-out target in the first ten for 12 users, versus 11 for centroid. Paired 1,000-resample nDCG@10 delta versus random is +0.1518 [0.0383, 0.2725], versus centroid +0.0056 [-0.0352, 0.0426]. This does not establish a stable gain over centroid or an online Reader result. All 29 target bundles have zero prior other-user popularity; the zero-hit popularity baseline is disclosed but not used as evidence of meaningful general superiority.

### Artifacts and final scope

- `.local/recommendation-multidirection/article-results.json`: 16 actual article/profile functional cases, plus separate public measurements.
- `subscription-results.json` and `apps/api/test/domain/recommendationMultiDirectionContracts.test.ts`: 20 exact controlled aggregation/subscription/ranking/feedback expectations.
- `collection-results.json` and `collection-audit.json`: preserved exploratory result and its protocol rejection.
- `collection-strict-sample.json`, `collection-strict-results.json`, `collection-strict-protocol.json`, cached item vectors and scripts/logs: authoritative strict-cohort experiment.
- `final-checks.json`: 62-test regression breakdown and typecheck/lint results.

**Conformance verdict for that bounded round:** all executed functional cases matched their stated expected results. This was controlled/local-adapter acceptance plus descriptive public-data evaluation, NOT proof that the public corpus had entered real favorites/Collections through the application's business flow. The human subsequently required that missing live simulation explicitly; the following section owns that additional acceptance.

## Public news through actual favorites and Collections — requested 2026-11-05

Current status: **fresh live rerun authorized and in progress after the human restored containers**. On 2026-11-05 at10:44 local, the parent verified healthy `dev-postgres`/PowerSync and a listening15432 port, but the local schema contained zero users and zero bookmarks; prior fixture records were not restored. The same frozen22 public-news excerpts will be used with new isolated actors, new record identities and separate run evidence. Bootstrap may reserve an unused local numeric-sequence range on the verified empty test tables to avoid overwriting cloud vectors or matching old local Workflow targets. No production database, old cloud vectors, unrelated Docker containers or existing persistent state are reset. This is a new test run, not restored evidence for old IDs. Fresh evidence lives in `.local/recommendation-live-simulation/rerun-20261105-024658/`. The first reserved billion-range actor IDs exposed the existing numeric Hashid encoding's unsafe-number limit and could not authenticate; this was an invalid test-identity choice, not proof that Collection permissions were broken. No authentication check was weakened. The actual fixture actors use verified lower noncolliding IDs100000000–100000005, with the unused high-ID attempt retained separately. A normal owned dev restart reconnected the restored database; unrelated containers were not changed. Four Collection shells were created through normal settings, and committed article bodies/native vectors are now being verified. The runner is checkpoint-preserving and waits for whole owner/reader groups rather than serially waiting for each article's visibility; no offline vectors or business rows are injected.

Historical interrupted-run status: **blocked by loss of access to the existing local test PostgreSQL**, not completed and not substituted by prior service-adapter tests. The live harness first received PostgreSQL `57P01` (terminated by administrator), then `ECONNREFUSED` at127.0.0.1:15432. Parent independently verified that both Docker contexts point to the same OrbStack socket, the current engine reports zero containers/images/volumes, and no PostgreSQL listener/process is available. The original `dev-postgres` volume is not currently discoverable. OrbStack processes and data-directory metadata show a restart/recreation around10:11 local; cause and recoverability are NOT established. No database/container/volume was recreated, reset, pruned, restored or deleted by this recovery inspection.

Partial material evidence before the outage: normal test-account bootstrap created users10–15; normal setting endpoints created four active Collections8–11. Sports-A bookmarks119–122/relations120–123 were saved through ordinary inline-content endpoints, starred, and read back as native article vectors and Collection `c:8` (aggregate cosine about0.999998). Sports-B bookmarks123–126/relations124–127 were created with successful source status but not yet fully starred/Collection-verified. The first script had stale pending snapshots/null body hashes; these were identified as invalid assertions and corrected in `live-resume.ts`, so they do not prove final body verification. Health/readers and actual recommendation responses were not completed. **No recommendation title list is available from this run.**

Evidence is retained in `.local/recommendation-live-simulation/live-runtime-blocker.json`, `live-status-before-resume.json`, live logs, account/corpus manifests and corrected scripts. The only explicitly stopped processes were the exact stale test runner and its children; the dev server was not stopped. Existing cloud test vectors may outlive the unavailable database, so a fresh bootstrap must not silently reuse identities and overwrite them. Restore the original local DB/volume, or obtain explicit authorization for a distinct fresh test environment and new-fixture run; the latter cannot be represented as continuation of the same stored records.

Planned bounded scenario: two public-news themes, two independent owner Collections per theme (four Collections), four public candidates per owner, and two readers with three private seed saves each (22 texts total before feedback). Public titles/abstracts are used verbatim and labelled as excerpts, not full article crawls. Actor names and every new record use an isolated test prefix; previous real/test favorites and shared originals are left unchanged.

Only initial test-account creation may use the existing normal `UserRepo.registerUser` path on the local database, with ordinary defaults and disclosed fixture IDs; no direct bookmark, Collection, subscription, status or vector seeding is accepted. All subsequent business data must go through normal authenticated application endpoints: favorites, star/publication, Collection settings, subscription/cancellation, recommended-item save and archive. The existing authorized test Vectorize/Jina environment is used; there is no production deployment or account/data backfill.

Required evidence:

1. Actual favorites/body persistence, owner identities and explicit source-commit-before-maintenance order; original excerpt hashes retained.
2. Starred public Collection membership and private seed exclusion verified from current business state.
3. Native article, Collection and both reader-profile vectors produced by the application, not copied from offline embedding caches or manually upserted by the harness.
4. Actual article and Collection recommendation HTTP responses, including complete returned titles, source Collection, score and same-theme/off-theme classification. Existing unrelated test candidates must remain visible in raw evidence rather than being filtered away to improve results.
5. Cold start before seed/subscription, two distinct reader preferences, own/saved/subscribed exclusions, and unsaved articles from subscribed Collections remaining eligible.
6. Normal save/subscribe/cancel/re-subscribe feedback changes the correct profile and next recommendation; owner unstar removes current public eligibility; archive remains neutral. Cancellation-of-renewal must not be confused with immediate subscription deletion.
7. Automatic Workflow completion must be distinguished from any explicit refresh intervention. A successful HTTP envelope alone is not proof of native/query visibility.

Functional expected outcomes and semantic observations are separate. Topic ranking/top-K composition is reported as observed, with no post-result corpus reselection, manual candidate injection, parameter tuning or claim of universal quality. New fixture IDs are retained for an explicit cleanup decision; this run must not erase earlier history to force a pass. Final live evidence is stored under `.local/recommendation-live-simulation/`.

### Restored-database live run — interim actual outcomes

Run folder `rerun-20261105-024658`, actual actors100000000–100000005 (four owners and two readers). All16 public candidates and6 private seeds were created through normal application requests; all four Collections have four starred members and native aggregate/profile checks. Database reads are observations, not seeding; the only non-HTTP business bootstrap was ordinary local test-user registration. No precomputed MIND embeddings or manual native upserts were used. The earlier billion-ID bootstrap/authentication attempt is separately retained and not counted as a functional recommendation failure.

- Sports reader actual top10 contained7 sports articles. First three: Looney preseason injury, Browns/NFL disappointments, and Trent Brown lawsuit. Across the16 public candidates, same-theme mean rank5.125 versus11.875 for health.
- Health reader actual top10 contained5 health articles. Its first result was the sports-labelled Trent Brown lawsuit, followed by the makeover article and another sports item. Same-theme mean rank8.625 versus8.375 for sports: the scenario did NOT demonstrate the predeclared same-theme mean-rank preference for this reader. This is a retained semantic observation, not masked by successful HTTP responses. No corpus, profile weight or production algorithm was tuned afterward.
- Collection recommendation after a same-theme A subscription returned same-theme B first for health (score about0.7737), followed by sports Collections; subscribing returned B created the exact A+B Collection preference and excluded both subscribed Collections. Article preference stayed unchanged.
- Sports reader's first Collection feed after subscribing A was empty, while a subsequent raw read returned sports-B first (score about0.8462). The first subscription-stage check is recorded FAIL, and B was not subscribed in that attempt. Do not claim complete feedback success from the later observation; a bounded, isolated follow-up is needed.
- Saving the actually returned Looney recommendation through the normal action created private destination bookmark/relation100000022 for sports reader100000004, wrote its native article vector, updated the article preference and removed the title from the next feed. Exact source/destination URL/ID exclusion is independently reviewed rather than relying only on title.

The completed primary-run record is `live-status.batch2.json` (finished 2026-11-05T03:45:50.161Z, SHA-256 `573534fdfabc8c1cdc631b370946c7a49256af107811d6785ea497337181a3af`). Subsequent orphan full-run restarts partially reset `live-status.json`; that partial file is NOT the authoritative completed run. Exact orphan test process groups were terminated without stopping the dev server or deleting fixture data. Main-run failures remain preserved rather than overwritten by follow-up success.

### Final live feedback retest and independent verification

A separate normal-API follow-up executed after the primary writer stopped. It used only the existing fresh fixture identities and returned Collection B from the raw recommendation response before subscribing; it did not inject candidates, overwrite vectors, refresh them manually or re-ingest the22 corpus records. Evidence: `followup-results.json`, `followup-raw.json`, `review-results.json` in the run folder. Both follow-up and read-only verification commands exited0; no test harness remains running.

- Sports reader100000004 had A100000000 active and B100000001 absent. The normal Collection feed returned sports-B, health-A and health-B. Subscribing the actually returned B produced the exact A+B Collection profile (cosine effectively1) and excluded both A/B.
- Normal unsubscribe-A removed its row and produced B-only preference; normal resubscribe-A restored A+B. The current article profile stayed unchanged through these subscription operations. Final health reader also has both health A/B subscribed; its remaining Collection suggestions are sports-A/B. Final sports reader suggestions are health-A/B. These off-topic lists after all matching fixtures were subscribed are expected exclusions, not evidence of a wrong profile.
- A known unsaved article from subscribed sports-A remains eligible. The saved Looney source is excluded by exact source ID and URL in both follow-up and final feeds; destination100000022 is a private committed save with its own native vector.
- Owner unstar removed the previously visible article from public recommendations while keeping its source body unchanged; star was restored. Reader-seed archive/unarchive recorded1then0, unchanged body hash and profile, with final archive_status0.
- Independent final readback confirms22/22 original corpus sources with committed keys/readable nonempty content, four owners with exactly4starred members each, exact native article identities/metadata/dimensions/norms, Collection member means, current article profiles and both readers' Collection profiles. This is actual app data and native test-index evidence, not local service adapters. The additional recommended-item private copy is counted separately from the22 original texts.

The follow-up has11 functional feedback assertions supported, plus2 separately classified observation/evidence-preservation checks. The original first-empty sports Collection response remains a user-visible transient with unconfirmed cause. Original `subscribe-reader-sports` and the dependent `cancel-resubscribe` checks remain FAIL in the primary record; the latter waited for B although B had not been subscribed after the first empty feed. Later successful normal-API feedback demonstrates current behavior, not that the first failure never happened.

Independent review summary is15supported/3historical-fail/1missing/1unable. Its three fails reflect original subscription/cancel/same-run-coverage evidence, not three newly reproduced product faults. The missing pre-A Collection response cannot be reconstructed retroactively. Exact source-before-vector ordering for every new record could not be correlated from the stored Workflow list without payload identity; prior other-scenario ordering tests do not fill this run's missing correlation. Same-source cross-user sharing is not a scenario in this22-unique-URL corpus. These gaps are retained, not converted into passes.

### Actual recommendation observations and verdict

Before feedback, sports reader top10 had7sports items and same-theme mean rank5.125 versus11.875. After saving the top Looney item, its first three became the Browns/NFL article, Trent Brown lawsuit, and Alamo Heights story. Health reader top10 had5health items; its first three include two sports-labelled items. Reader article-profile cosine is approximately0.77005, so the profiles are distinct, but category-level recommendation quality is weaker for the health scenario. Corpus/weights were not adjusted after seeing this result.

**Verdict:** the requested actual favorites → published Collections → native vectors/profiles → real recommendation → save/subscription/cancel/revocation/archive flow has now been exercised with the recorded follow-up. Core final-state checks and targeted feedback pass. It is NOT an uninterrupted all-green first run, nor a claim that health recommendations are sufficiently relevant. Remaining observations are the first transient empty Collection feed, health-theme relevance, and the explicitly missing historical/order evidence above.

Retained local test data: owner users100000000–100000003, reader users100000004–100000005, Collections100000000–100000003, original corpus bookmarks100000000–100000021, private saved-recommendation bookmark/relation100000022, and their normal subscriptions. Unused billion-range bootstrap actors and old cloud fixtures are not silently deleted. No production source, recommendation weights, schema, dependency, account security or production data was changed by this rerun.

## Standard-algorithm ranking: PinnerSage α calibration — 2026-11-05

Scope: offline measurement on cached public MIND data only; no provider, cloud or production access. Artifacts: `.local/recommendation-pinnersage/` (first measurement) and `.local/recommendation-pinnersage/calibration/` (protocol, scripts, results).

- First derived value `α = 0.4` (from `cos ≥ 0.8`): 89.8% of history unclustered, 25/60 users without a cluster; medoid retrieval underperformed the single profile at equal budget (Recall@100 11.3% vs 13.3%). Cause measured on the same 1,945 vectors: same-subcategory pairs average cosine 0.639 (2.4% ≥ 0.8) and different-category pairs 0.560; the mean vector has norm 0.754.
- Calibration protocol frozen before metrics (`calibration/protocol.json`, sha256 prefix `043a6621`): 20-value grid of observed Ward merge-height percentiles plus 0.4; PinnerSage section 5.3.1 retrieval at total budget 100; targets T1 = 91 impression positives, T2 = 98 leave-last-2-out history targets from 49 users; selection = max pooled micro recall of the medoid channel, ties by relevance then smaller α. Mojena's rule reported only as a reference.
- Result: `α = 0.6688538990` adopted. Medoid channel pooled recall 14.8% (28/189), relevance 22.2%; 8.72 clusters per user, 7 users without a cluster, 35.7% unclustered. The union of profile and medoid channels (production behaviour) beats the profile channel alone at every grid value (best 18.0% vs 10.1%).
- Limits: the winner leads its neighbours by one target; a macro-pooled reading of the rule would pick 1.0416 instead. 60 users, titles and abstracts, no click times (importance equals cluster size), a 1,945-vector catalogue and Jina v5 embeddings differ from Slax full text and the paper's setting. Recalibration on Slax replay data is pending authorization.

## Standard-algorithm ranking: pre-registered variant evaluation — 2026-11-05

Scope: cached public MIND data, held-out evaluation; no provider, cloud or production access. Artifacts: `.local/recommendation-variants/` (`protocol.json` sha256 `14555ddf…` frozen before metrics, `run.ts`, `results.json`, `README.md`).

Design: two user folds by sha256 parity (24/36 users), calibration on the train fold only, paired bootstrap over users (2,000 resamples, seed 20261105). Adoption required a 95% CI excluding 0 in the variant's favour on held-out folds.

| Variant | Primary metric | Current → variant | Δ (95% CI) | Verdict |
| --- | --- | --- | --- | --- |
| V1 centering (mean removal) | union Recall@100, 189 targets | 15.34% → 21.16% | +5.82 pts [+2.16, +9.68] | adopted |
| V2 per-user Mojena cut | union Recall@100 | 15.34% → 14.81% | −0.53 pts [−3.96, +2.89] | not adopted |
| V3 PinnerSage max-medoid ranking | impression AUC | 0.5540 → 0.5361 | −0.018 [−0.074, +0.039] | not adopted |

Centered centroid ranking AUC 0.6782 versus raw 0.5540 (+0.124, CI [+0.048, +0.201]). V1's retrieval gain is larger on leave-last-2-out targets (23.47% vs 14.29%) than on impression positives (18.68% vs 16.48%), and V1 retrieves about 5% more items. Three variants were judged separately without family-wise correction. Implementation (`α_c`, `μ` source, simpler production forms, Collection check) follows task 4.10.

## Test update after the algorithm replacement — 2026-11-05

Default API suite: 3,232 passed, 118 skipped (environment-gated), 0 failed; 219 files passed, 15 skipped. Typecheck and lint pass (0 errors, 343 pre-existing warnings); `openspec validate --all --strict` 92/0. Changed assertions follow the new spec, with expected values from the independent reference or hand computation. One narrowed path: a subscription created between candidate hydration and response is not re-checked after the single hydration; deterministic subscription exclusion and post-recall revocation remain covered.

Offline replay harness for Slax data: `.local/recommendation-replay/` (protocol sha256 `7aa6889e…`, independent numpy recomputation, runbook). Smoke-run on local fixtures only as a wiring check. It is run by the human against production after full code review and deployment and after the full-history v5 refresh; agents do not run it against production.

## Representation centering: production parameters — 2026-11-05

Artifacts: `.local/recommendation-variants/centering/` (`protocol.json` sha256 `d9f7df55…` frozen before metrics; `run.ts`, `results.json`, `README.md`). Cached public data only.

- `α_c = 1.6459373070` from the frozen V1 grid and rule applied to all 60 users: union recall 22.22% (42/189), relevance 32.28%. It ties with 1.7016 (42 hits) and the next value drops to 37, so it is not a plateau; the held-out fold values (1.6206, 1.6913) bracket it. As a production parameter it is in-sample; the held-out V1 result remains the adoption evidence.
- Ranking profile: exact `normalize(Σ center(e_h))` AUC 0.6782, request-time `center(Ŝ)` 0.6447, raw 0.5540. The rule allowed the simpler form (Δ CI [−0.0068, +0.0773]), but the exact form is kept because the simpler form is not the standard formula (see `design.md` 6.6).
- `μ` robustness: random subsamples of 50/100/300/1000 vectors (20 seeds each) keep the gain over raw at their 5th percentile (N=50: recall Δ p5 +1.01 points, 19/20 seeds; AUC Δ p5 +0.095, 20/20). Disjoint halves both beat raw but differ by 2.1 points.
- Collection centering: nDCG@10 0.2814 vs 0.2368, Δ +0.045, CI [−0.040, +0.139] on 29 users; not adopted, Collection ranking stays raw.
- MMR `Sim2` (reference only, no verdict): raw 0.3424 vs centered 0.3148 nDCG@10; kept raw.

## Centering and feedback interface: automated checks — 2026-11-05

Production: `μ` asset `ebb4b388aad2` (provisional, 1,945 MIND representatives, generated by `pnpm api -- vector:mean`), `α_c = 1.645937307`, exact centered profile record `u:<id>:article:centered`, raw native retrieval and MMR `Sim2`, raw Collection ranking; feedback interface per `design.md` 6.7 with one pipeline batch per request. Algorithm identifier `0cb14d31aac1`.

- Default API suite: 3,303 passed, 118 skipped (environment-gated), 0 failed; 222 files passed, 15 skipped. Typecheck and lint pass (0 errors, 343 pre-existing warnings); `openspec validate --all --strict` 92/0.
- The independent reference now uses the shipped `μ` as fixed input. Differential tests cover centered Ward clustering and medoids at `α_c`, centered ZoRRO order from the exact stored profile (a deliberately non-derived stored profile proves request-time `center(Ŝ)` is not used), MMR with raw `Sim2` (a case where centered `Sim2` would choose differently), and raw Collections.
- Storage: both user records in one upsert with a shared token that changes with the `μ` version; `verifyRefresh` fails when either record is missing; empty users remove both; a missing record makes the profile unavailable (cold start). The AI entry accepts only the `:centered` suffix.
- Feedback: 40 parser cases and 34 controller cases (strict rejection, one batch per request, nothing recorded for invalid bodies, served-event shape for both kinds and for empty results). Algorithm hash covers every exported parameter and the `μ` version.
- The unit test that wrote evidence files into `.local/` no longer does; its 20 assertions are kept.
- Declared limits: stored centered profiles are not compared with the current `μ` version at read time, so after a `μ` regeneration the required preference refresh must run before results reflect the new mean; feedback `item_id` is validated by shape only because impression membership is not stored.

## Feedback recording end to end and real-app rerun — 2026-11-05

Environment: standard `pnpm api -- dev` (started after the last source edit), local PostgreSQL, real Jina and test Vectorize indexes, test account `52bb95cd…` only; the login's other account was never used. Event pipeline: binding `SLAX_READER_STREAM_STREAM` → stream `slax_reader_stream` → R2 Data Catalog table `logs.events` in bucket `slax-reader-logs` (300 s rolling). Evidence: `.local/recommendation-feedback-e2e/phase2/` (`README.md`, `evidence.json`, `e2e.json`, `scenario.json`).

- Preference refresh through the ordinary endpoints for readers 100000004 and 100000005: `u:<id>:article`, `u:<id>:article:centered` and `u:<id>:collection` exist natively for both (1024 dimensions, unit norm, `embedding_mean_version` `ebb4b388aad2`). Vectorize returned intermittent 500s; retries are logged.
- Task 4.12, 22/22 checks: article impression (15 items, 16 feedback events) and Collection impression (2 items, 3 events), algorithm `0cb14d31aac1`. The sink holds exactly one served row per request with the returned items, positions and scores (within 1e-9), one feedback row per valid event, and no row for an invalid body (HTTP 400). Ingest 3.4–5.9 s. The join by impression ID gives AUC 1.0 for both (one click each; a wiring check, not a quality measure).
- Rerun with the new ranking over the same 22-article corpus: sports reader 15 items, 7 same-theme, mean rank 4.0 (previous run 5.125); health reader 16 items, 8 same-theme, mean rank 4.625 (previous 8.625), top-10 share 0.80 (previous 0.50). Candidates were 4.4–4.8 hours old (decay 0.931–0.936), so freshness changed at most two adjacent pairs. Many factors changed between runs; this shows the current behaviour, not which factor caused the difference.
- Finding: the health reader's `interests` is empty. Its three centered representatives are 1.96–2.00 apart, above `α_c`, and Algorithm 1 as written selects only merged sets, so no medoid channel runs for that user. The sports reader has one cluster. See the open decision on singleton clusters.

## Review decisions — 2026-11-05

- Approved and scheduled: orphan-chunk cleanup after a failed representative write (task 3.9), complete-text-first embedding (task 3.8), and the bulk article/preference split (`vector-bulk-sync` task 3.5).
- Declared limitations, not fixed by decision: (a) a committed Fork whose acknowledgement is lost is retried as a foreign write and skips maintenance; repair is the ordinary bookmark refresh action. (b) Cached podcast recovery is blocked when its database commit failed and the canonical episode inputs changed before the retry. Both need an uncommon failure sequence.
- On hold until the human refreshes the platform: whether `α_c` and `μ` derived from MIND (Microsoft Research licence, research use) may serve production. If not, the production sequence is article refresh only, `μ` and `α_c` from production v5 vectors, then preferences.
- Live imports still recompute the user's preference once per imported article through the maintenance Workflow; the bulk split does not change that path.
- Superseded assistant decision: retaining `pdf-lib` for local page counting was not approved after the human requested its deletion. The human has reaffirmed removal. Task 3.10 removes the dependency, local page-count parsing and page-prediction-based PDF response bound together; the historical memory measurements below describe the removed path, not a justification to retain it.

## Sequencing decision — 2026-11-05

The human paused further recommendation changes: ranking stays as implemented (PinnerSage Algorithm 1 read literally, `α_c = 1.6459373070`, provisional `μ`). The singleton-cluster comparison is recorded in `.local/recommendation-variants/singletons/` (same `α`; zero-cluster users 6/60 vs 0/60; union recall 22.22% vs 22.75%, Δ CI [0.00, +1.80]) and is not adopted now. Current priority is the write path (entry-point vector maintenance and the bulk script); the human then runs the bulk refresh, after which recommendation work, the singleton question and the MIND-licence question resume.

## Write-path fixes: automated checks — 2026-11-05

Fixed: account-deletion vector cleanup fails before destructive deletes; PowerSync create/re-save snapshots resolve the persisted relation; a missing cached chunk re-embeds; media status reads keep generation-on-open and catch-up and dispatch maintenance only after their own committed write; unchanged PDFs reuse vectors; subscriber fanout uses only counted subscriptions and skips unchanged Collections; only deployment preflight requires v5 bindings; complete text is sent first; representative-write failure removes surplus chunks; optional `preference` on the bookmark action and the four-stage bulk script (`article-preference` selects each user's largest successful relation).

Default API suite: 3,320 passed, 118 skipped (environment-gated), 0 failed; 222 files passed, 15 skipped. Typecheck and lint pass (0 errors, 343 pre-existing warnings); `openspec validate --all --strict` 92/0. Superseded assertions were rewritten from the spec and listed by the test agent; new coverage exists for each item.

## Write-path live checks — 2026-11-05

Environment: standard `pnpm api -- dev` restarted at 17:05:06 after the last source edit (16:46:38), local PostgreSQL and PowerSync, real Jina, test indexes on account `52bb95cd…` only. Evidence: `.local/write-path-live/` (`README.md`, `evidence.json`, `check1.json`–`check9.json`, `provider-spend.json`). Vectorize returned intermittent 500s; Workflow and refresh retries recovered them.

| Check | Result |
| --- | --- |
| Permanent delete of a 3-page PDF | Pass: representative and all chunks removed natively, raw and centered article preference recomputed. Closes the missing A07 evidence. |
| Trash then immediate restore | Pass: article stays written and refreshable, no `missing_dependency`. |
| PowerSync re-save with a fresh upload UUID | Pass: one relation remains, maintenance ran for the persisted relation. |
| PDF star/unstar reuse | Pass on vectors (identical digests, metadata-only upsert); absence of a Jina call inferred from the reuse branch, not counted (no per-request provider log). |
| Owner's unstarred private save | Pass: Collection `unchanged: true`, no subscriber steps. |
| Complete text first with a real overflow | **Fail**: a 200,001-byte text returned HTTP 400 `Input at index 0: Input exceeds the model's maximum length…`; the ContextOverflow pattern did not match, so no bisection and the article failed. Fix scheduled. |
| `pdfInput` on 8,000,000 bytes in workerd | Pass for a 1-page file: +13.9 MiB process RSS. A many-page file is still to be measured. |
| Bulk script, one user | Pass: dry-run 0 requests; real run 5 article requests with `preference:false`, 1 article-preference request, 1 Collection request, exit 0. |
| Media status catch-up | Unavailable: no cached ready media fixture exists locally; covered by unit tests only. |

## Final review findings and decisions — 2026-11-05

Three read-only reviewers (write path, vector/media, recommendation/scripts) found, after verification against HEAD:
- Scheduled fixes: successful re-saves return early (raw ID to Telegram links, PDF title repair skipped, cached post-processing incl. legacy search indexing skipped); Collection setting edits dispatch maintenance for presentation-only fields; the bulk CLI drops structured `missing_dependency:<id>` reasons; the `μ` asset takes its model name from the live constant, so the model check cannot fail; the ContextOverflow pattern above.
- Deferred with the paused ranking work: negative ZoRRO scores can underflow before the 50-candidate cut (rare), and Collections without eligible members can occupy the cut before member admission (uncommon).
- Declared limitations: a media body commit whose acknowledgement is lost dispatches no maintenance until the next committed change (same class as the Fork acknowledgement limitation); if a first representative write and its compensating chunk deletion both fail and the save is deleted before any successful refresh, its chunks remain in the index (needs an index outage at write time).

## Write-path live recheck after final fixes — 2026-11-05

Dev server started 18:49:02 after the newest source edit (18:45:20); test account only; evidence `.local/write-path-live/phase4/`. 22/22 checks pass.

- Real overflow: a 200,001-byte text was sent whole, Jina answered HTTP 400 `Input exceeds the model's maximum length`, the pattern recognised it, bisection was lossless and the article was written natively with `part_count = 2`.
- `pdfInput` on a 400-page PDF of exactly 8,000,000 bytes in workerd: parse 52 ms, process RSS +79.0 MiB (1-page file: +13.9 MiB). RSS includes runtime and body; the isolate limit is 128 MB, so many-page PDFs near the direct threshold are the memory edge to watch in production.
- URL re-save of a successful article: completed response in 101 ms; a skipParse CrawlWorkflow ran only `vector-maintenance` and `post-processing`; status, `updated_at`, content keys and raw rows unchanged.
- PDF metadata repair: identical re-upload repaired title/author in the request; a cached PDF re-save repaired it in the Workflow `repair-pdf-metadata` step; the original key was unchanged in both.
- Collection name-only edit created no maintenance Workflow.
- Bulk article-preference stage with a removed member vector reported `missing_dependency:a:100000002:100000032`, failed 1, exit 1.

Final focused re-review fixes: completed duplicate PDF uploads no longer run overview/tag AI generation; a cached-Workflow admission failure after a committed save is logged and alerted instead of failing the save. Declared limitation: if cached Workflow creation succeeds but its acknowledgement is lost, the retry can create a second instance and repeat post-processing and maintenance. Duplicate work is not a guarantee of transactional or global idempotency.

## Final local handoff checkpoint — 2026-11-05

- The last two fixes have additive regressions for committed-save acknowledgement, PDF AI-generation suppression, three exhausted Workflow admission attempts with retained alerts/events, and import relation/progress handling. Final default suite: **3,338 passed, 118 skipped, 0 failed; 222 files passed and 15 skipped**. Typecheck passes; lint has 0 errors and 343 existing warnings; strict OpenSpec validation has 92 passed and 0 failed. These tests do not convert the skipped integrations or missing live media fixture into passes.
- Current-source standard build `pnpm api -- build --config deploy/cloudflare/api.toml.example` passes all four offline Worker bundles, exit 0. Gzip sizes: core 6,731.88 KiB, edge 6,765.52 KiB, ai 6,728.31 KiB, browser 150.29 KiB. Only the public template and an empty vars file were used; no deployment or production operation occurred. Build log: `.local/build-verification/api-build-20261105T112416Z.log`. Tracked diff hash before/after the build: `4a9438b8232309234529a15ea02bce37219b9970ba94d6c9d8be2dedcfabc431`; untracked source was bundled from the working tree, not certified by that tracked-diff hash.
- Phase-4 live checks passed 22/22 before the final two small fixes; those last fixes were verified with controlled regression tests, not a new cloud replay. `pdfInput` memory measurements are host-process-tree RSS for generated fixtures, not isolate-heap measurements or a production memory-safety guarantee.
- Open write-path items: task 3.7 lacks a current cached-media live case; task 3.9 retains the double-failure orphan-range issue. Merely documenting these does not resolve them or establish human acceptance.
- Recommendation changes, singleton handling and MIND-derived parameter use remain paused per the human. The two static ranking findings remain unresolved, not silently waived. Security review, production configuration/headroom, full-history execution, search cutover, commit/PR/deployment and archival remain separate gates.
- Operator ownership: the human deploys and runs historical refresh/replay after review. The article-only script stage does not calculate user preferences, but normal live mutation hooks still use the existing preference-maintenance path; selecting `--kind article` is not a system-wide ranking or maintenance disable switch.

## Explicit pdf-lib removal — 2026-11-05

The human reaffirmed that the dependency must be deleted; the prior assistant-authored retention decision was withdrawn. `pdf-lib` and its `@pdf-lib` transitive packages are absent from the API manifest and pnpm lockfile (regenerated by pnpm, now matching HEAD). Current production source, tests and all four Worker bundles have zero `pdf-lib` references. Existing upstream PDF text/metadata extraction remains unchanged; no replacement PDF parser or dependency was added.

- Vector input preparation now only checks existing byte budgets, rejects empty input and base64-encodes the unchanged original. PDF responses derive output count from validated nonempty provider data, with exact model, finite nonzero 1024-dimensional embeddings and unique contiguous indices. Text/image expected-count checks and bounded error reads are unchanged.
- Tests reuse `test/helpers/pdfFixture.ts`, including exact 8,000,000-byte preparation and 400 provider vectors in a response over 2 MiB. Larger-original text fallback, no original GET, missing-text failure, original-byte reuse, malformed responses and interruption/deadline failures are covered. No fixed page limit was introduced.
- Final default suite: **3,345 passed, 118 skipped, 0 failed; 222 files passed, 15 skipped**. Typecheck and lint pass (0 errors, 343 existing warnings); strict OpenSpec 92/0; all four Worker dry-run bundles pass using the public template. Core/Edge/AI bundles are about 0.9 MiB smaller uncompressed than before removal. Logs: `.local/build-verification/api-build-after-pdf-lib-removal-20261105T120132Z.log` and `.local/build-verification/pdf-lib-removal-verification-20261105T120427Z.log`.
- Native JSON parsing still materializes PDF provider responses. The workerd 8M/400-vector test observed roughly 98 MiB of combined heap/backing at a sampled point; the former 64 MiB fixture-specific heuristic assertion was removed. This is explicitly a memory observation, not a production-isolate safety guarantee. Output count alone cannot independently verify provider completeness against source pages. No new live/cloud calls or production operations were made for this removal.
- Tooling note: pnpm ran the existing root prepare/lefthook-install lifecycle and reported a pre-commit hook sync despite the attempted ignore-scripts environment flag. No commit, reset, checkout or further hook changes were performed.

## Independent Collection updates and index verification — 2026-11-05

The human explicitly requested removal of automatic subscriber preference fanout after Collection updates. Article targets still update the owner's article preference and independent owned Collection vectors; Collection targets still update member-publication metadata and their own representation. Neither target enumerates subscribers, whether or not the Collection changed. Subscription/cancellation/expiry, explicit user refresh, the bulk subscription stage and separately scoped account-deletion cleanup remain. Stored user Collection preferences are not automatically refreshed on each Collection content change. This supersedes earlier fanout instructions and tests; it does not authorize a new scheduler or ranking change.

Fresh read-only Wrangler verification on the authorized test account `52bb95cdad45ee5441e67b3a1e9dce5b` confirms all three V5 indexes exist with 1024 dimensions and cosine: `reader-test-v5-article` (created 2026-11-03T08:24:43Z), `reader-test-v5-collection` (08:24:49Z), and `reader-test-v5-user` (08:24:45Z). The snapshot reported 115 article records, 7 Collection records and 21 user records; these are point-in-time vector counts, not logical article/user totals or capacity estimates. Evidence: `.local/vector-index-verification/evidence.json` and README. No indexes or metadata indexes were created, deleted or changed during this verification.

Server-reported article filter indexes include `kind: String`, `user_id: Number`, and `recommendable: Bool`; Collection includes `recommendable: Bool`. These match the current native filters. The user index returns an empty metadata-index list and uses exact-ID reads. Legacy `generation`, `recipe`, `recipe_digest`, and unused `published_at` metadata indexes remain on the test resources; no cleanup of unrelated/historical fields was performed. The implemented article owner-filter branch has a numeric native index but is not the currently serving search path. Production was neither queried nor created by this task; test resource verification is not proof of production provisioning.

No-fanout regression: 15 Workflow tests pass, including changed/unchanged Collections, member pagination and zero versus 503 configured subscribers yielding identical step traces with zero subscriber reads or refreshes. The owner's article preference still refreshes for article targets; Collection targets refresh member publication metadata then only their independent Collection vector; explicit user targets refresh only that preference. All 175 preserved subscription/manual/cancellation/expiry/account-deletion tests pass.

Final default suite: **3,348 passed, 118 skipped, 0 failed; 222 files passed, 15 skipped**. Typecheck and lint pass (0 errors, 343 existing warnings); strict OpenSpec 92/0. The current-tree four-Worker dry-run build using only `deploy/cloudflare/api.toml.example` passes 4/4; log `.local/build-verification/api-build-no-subscriber-fanout-20261105T123939Z.log`. No provider calls, production operations, index mutations or live application writes were made for this correction; the fresh remote index inspection was read-only.

## Human-authorized production index completion — 2026-11-05

The human subsequently explicitly requested production index creation and an updated flowchart. This authorization covers the V5 indexes and required filtering indexes only; it does not authorize deployment, private configuration edits, historical backfill, replay, provider calls or production content changes. Commands pinned `CLOUDFLARE_ACCOUNT_ID=f74694cd77e247e071af286f40d20116` and disabled dotenv loading/metrics. Login account discovery and the earlier recorded production mapping were checked before mutation; no credential/config files were read.

Fresh `vectorize list/get/info` showed that all three production V5 indexes already existed, each with 1024 dimensions, cosine metric and zero vectors: `reader-prod-v5-article` created 2026-11-03T08:24:43.340985Z, `reader-prod-v5-user` at 08:24:45.747179Z, and `reader-prod-v5-collection` at 08:24:48.064418Z. They were not recreated. The earlier user-facing statement that production had not been created was based on incomplete verification and must not be read as the actual resource state.

The article and Collection indexes initially had no metadata indexes. Only these missing native filters were created, then read back after asynchronous propagation:

| Index | Field | Server-reported type | Creation mutation ID |
| --- | --- | --- | --- |
| reader-prod-v5-article | kind | String | a5c88831-9522-413e-99e7-59e4d20ba867 |
| reader-prod-v5-article | user_id | Number | 8ffe1483-f114-49eb-b616-035717436d66 |
| reader-prod-v5-article | recommendable | Bool | a10ce6ed-159a-4662-812a-982654ac0a08 |
| reader-prod-v5-collection | recommendable | Bool | 1e9b1fcc-58c3-4b3a-a8a9-749225353131 |

The user index intentionally has no metadata filters because it uses exact-ID reads. No unused generation/recipe/published_at filter indexes were added. Intermittent network failures were retried as reads, and successful create requests were not blindly resubmitted. `list-metadata-index` returned all four fields with the expected types, not merely an enqueued acknowledgement. Index information confirmed the production stores were empty during provisioning. Existing `bookmark-1` through `bookmark-5` were left untouched, as were all vector values, application bindings and deployment state. No production query/read-write application smoke was performed; resource availability is not application-deployment verification.

## Recommendation layering refactor and concurrency verification — 2026-11-05

The human requested correcting layering before running tests. Production changes were completed first: a single existing-style `ContentRecommendationOrchestrator` under `domain/orchestrator/` now owns impression/algorithm response assembly and served/feedback event coordination. The Controller retains authentication, query/body validation, HTTP errors/envelopes and cache headers. The ranking Service, SQL Repositories, algorithm functions, candidate schedules and vector-read limits were not rewritten. Real `gen:all` using public configuration regenerated the DI chain Controller → Orchestrator → Service. No production/cloud/index operations occurred in this refactor.

Tests ran only after implementation. The generated container was actually imported, populated with fixture repository/vector dependencies and used to resolve all three components; the test checks instance wiring, not just source text. Composed tests run the real Controller, Orchestrator and event helpers with a captured pipeline and drain `waitUntil` promises. HTTP/event fields, validation-before-side-effects, one feedback batch and nonblocking delivery-failure logging remain covered.

Deferred-promise tests establish the actual article sequence: exact profile read → interest sampling → representative-vector read → one concurrent retrieval wave of profile ANN, up to three medoid ANN calls, latest SQL and popular SQL (six calls maximum) → wait for every source → candidate deduplication and authoritative SQL hydration → candidate-vector read → unchanged scoring/MMR. No Jina call is introduced. With no interests the retrieval wave has three calls; cold start returns without retrieval. This proves concurrent initiation at the application layer, not server-side parallel execution inside PostgreSQL or Vectorize.

Through public vector-read methods, a 101-ID test observes six pages of sizes `[20,20,20,20,20,1]`, a peak of four outstanding native reads and all IDs returned; later pages launch only when a slot is free. Unexpected identities and provider errors still propagate. Collection recommendation retains its dependency-ordered stages; its vector reads use the same bounded batching.

Focused verification: **109 tests passed**. Final default suite: **3,367 passed, 117 skipped, 0 failed; 226 files passed and 15 skipped**. Typecheck and lint pass (343 existing warnings, zero errors), strict OpenSpec 92/0, and all four current-tree public-template Worker dry-run builds pass. Logs: `.local/recommendation-refactor-verification/`. The test TypeScript is executed by Vitest and is excluded from the project's source typecheck; this is not a new test typecheck guarantee. No latency measurement was performed, and the earlier 19–27 second test-environment observations do not establish a speedup from this refactor. Prior open review/production gates remain unchanged.

## Dedicated task-key refresh and native Repository boundary — 2026-11-06

The human explicitly replaced the former Reader-login/team-email, relation-ID and combined refresh behaviour. Current four actions accept private article `{user_id, bookmark_id}`, independent Collection `{collection_id}`, or direct `{user_id}` for either preference kind. Every action processes one logical target only, requires the fixed `VECTOR_REFRESH_SECRET` at both Edge and Core, and has no cascade. Old relation/subscription-ID forms, the preference flag and login-based maintenance wrappers were removed; live automatic workflows and ranking are unchanged. The sequential caller uses the same secret from environment, sends one target at a time and visits each active user once in each preference stage, including empty users for cleanup. No real secret was provisioned, logged or read.

AiEntry now delegates only. Native binding selection, input/metadata validation, normalization, filters and operations live in `infra/repository/vectorIndexRepo.ts`. New RPC names are getVectorsByIds/upsertVectors/deleteVectorsByIds/queryVectors; the remote client imports the Repository-side RPC contract rather than Entry. Legacy five-shard serving-search methods are signature-compatible. Real gen:all regenerated routes/DI/environment types using public configuration; generated files were not hand edited.

Verification after implementation: **3,463 passed, 117 skipped, 0 failed; 229 files passed, 15 skipped**, source typecheck/lint and strict OpenSpec passed, four current-source public-template dry-run Worker bundles passed. In addition to Node integration, an actual isolated Workerd/Miniflare test runs Edge → Core → generated routing/middleware/Controllers → real maintenance Service using temporary keys and fixture data/provider/index boundaries, including native timingSafeEqual. It verifies secret-only success, mismatched/missing credentials, forged Edge identity, trailing-slash aliases, old-body rejection and exact target outputs. No production/cloud refresh or private key was used; Docker/Postgres smoke was not rerun. Details and logs are in `../vector-bulk-sync/validation.md` and `.local/task-auth-verification/`. Independent focused review found no concrete task-auth/Bugs/Compliance defect. Unrelated earlier lifecycle limitations, paused ranking findings, the broad Security review, production deployment and historical replay remain open as previously recorded.

## Pull request delivery after dev synchronization — 2026-11-06

The human explicitly requested a configuration PR, synchronization with upstream dev, creation of `feat/embedding-jina-v5`, inclusion of the missing Workflow/vector bindings in the configuration PR, and then a source PR. This authorizes the commits, pushes and PR creation in this delivery, superseding earlier session-specific prohibitions on those operations without approving deployment, production refresh, secret creation or any new implementation scope. Planning requirements and unchecked tasks are not changed by this evidence entry.

The branch starts at `origin/dev` commit `dd30199e77f3b32e5b9bf56849bbaed66822087c`. All 76 previously modified tracked paths and 88 previously untracked files were preserved; four stash-application conflicts were reconciled against upstream behavior. The original backup remains in Git stash commit `6e857c1d0664caa5f4a8aed3a5262214da9160b3`. The new upstream transcript-repair implementation is preserved with local maintenance hooks; three test-fixture incompatibilities were reconciled without changing upstream business behavior.

Current-tree verification:

- `pnpm api -- gen:all`: passed; models, runtime types and registrations generated through their owners. No generated file was edited by hand.
- `pnpm api -- test --silent --reporter=dot`: 3,774 passed, 117 existing environment-gated skips, zero failures; 239 files passed and 15 skipped.
- The complete suite executes the actual Workerd/Miniflare search socket tests (early partial, one final result, channel failure, disconnect/cleanup), the real Edge/Core task-secret route test and the real Workerd large-PDF routing test. HTTP, routing, authentication, Controllers and application orchestration run in Workerd; database/provider/index boundaries are isolated fixtures. These results do not claim live production or real Jina/index acceptance of this synchronized tree.
- `pnpm api -- typecheck`: passed, including shared contracts.
- `pnpm api -- lint`: zero errors, 344 warnings; not claimed warning-free.
- `pnpm exec openspec validate --all --strict`: 111 passed, zero failed.
- `pnpm agent:check`: passed, including generated workflow drift checks.
- Public-template four-Worker build and actual dev/beta/prod/legacy-main configuration builds passed using `pnpm api -- build`; all 16 environment bundles were generated locally with dry-run only. Temporary build directories were removed and private binding values were not printed.
- Source delivery scope contains no schema/migration, lockfile or CLI/Extension/Mobile changes. Added shared search contracts have no consumers in those packaged clients; existing search contracts remain unchanged. This API-only/additive unconsumed contract change requires no client package-version increment.

Configuration companion: `slax-lab/slax-reader-config` PR #10, commit `ba0edc7`, includes the request-signal flag, three V5 indexes and maintenance Workflow in all four files. Actual configurations pass `checkDeployment` and ownership assertions (AI native indexes; Edge Workflow implementation; Core binding to Edge), and 35 deployment/generator tests pass. Old serving indexes and all runtime variable values remain unchanged. JINA_API_KEY and Core/operator VECTOR_REFRESH_SECRET still require private operator verification. Coordinate all environment source rollouts because old Edge code does not export the new Workflow.

Pre-push review covered Bugs, Security and Compliance on the changed lifecycle/terminal paths, task-secret Controllers, streaming admission/fusion, native owner filtering, generated binding topology and source delivery boundaries. The existing task 3.9 compensation gap remains an Important unresolved issue: failed representative upsert followed by failed compensating chunk deletion can leave orphaned chunks without a durable record of the range (`src/domain/vectorMaintenance.ts` cleanup branch). This delivery does not silently introduce a new recovery platform. Scoped credential-pattern inspection found no new private-key/token literals in the 164-file delivery scope; this is not a comprehensive secret audit. Existing broad Security, complete lifecycle acceptance, historical paused-algorithm and production gates remain open.

The source PR is intentionally a draft for review, not an assertion of merge or production readiness. No production deployment, index creation, metadata cleanup, provider request, migration or historical backfill was executed. Full live database/provider coverage represented by the 117 skipped tests was not run in this delivery. The historical planning notes and unchecked tasks remain unchanged; classify them and resolve remaining blockers before marking ready or archiving after merge.
