# Design

## Context

See `proposal.md` for motivation and the confirmed scope. The diagnosis found:

- `apps/web/nuxt.config.ts` emits the mutable `/_nuxt/worker-v4.js` with content-hashed internal dependencies. The live entry advertised a one-year immutable cache policy. An old SQLite JS URL from the incident returned HTML; current SQLite WASM was valid. The precise failed WASM request is unavailable, so the complete incident chain remains strongly supported rather than reproduced in the affected browser.
- The current Pages helper stages only the current build, confirms publication, then purges the selected hostname. It does not merge old assets. Purging the edge does not terminate running Workers or invalidate a fresh browser cache.
- The inspected SDK uses unencrypted IDBBatchAtomicVFS. The SDK's Worker graph also contains VFS, synchronization, and shared JS dependencies; retaining only files named wa-sqlite would be incomplete.
- The adapter is always injected. Its factories can return null after database startup fails. BookmarkTags blocks REST on adapter presence; BookmarkCell also replaces the REST bookmark ID with zero on that condition.
- Existing recovery stops on initialization timeout or failed cleanup. This policy and the existing browser-specific initial mode must remain intact.
- The user selected a 7-day retention window after replacement and explicitly prioritized normal publication when historical recovery fails. Historical gaps warn and continue; current-build resource defects remain blocking. No other active change carries deltas for the two affected capabilities. Preserve the anonymous startup behavior covered by optimize-web-lcp.

## Goals / Non-Goals

**Goals:** preserve recoverable old Worker dependencies over the agreed window without blocking a healthy new release on historical failures, require valid current resources, correct entry caching, and restore tag editing after startup fallback without changing local data.

**Non-goals:** see the proposal. Runtime asset preservation is scoped to the actual PowerSync Worker graph, not every old application chunk. A page whose own application files are unavailable is outside this scope. The 7-day window is a retention target with reported exceptions, not an unconditional availability guarantee. No guarantee is made for a legacy browser cache first starting an obsolete runtime after its compatibility window.

## Decisions

### 1. Keep the split runtime and generate a dependency index

Keep the existing ES module Worker format, dynamic chunks, separate WASM files, and content hashes. Do not change POWER_SYNC_WORKER_GENERATION, POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION, or SDK dependencies as part of this repair.

Generate a small `/_nuxt/powersync-assets.json` from the production Worker bundler output. It identifies the PowerSync database/synchronization roots and their complete transitive emitted dependencies by original URL path and SHA-256 digest. Follow imports, dynamic imports, and emitted asset references rather than a filename glob. Include referenced shared chunks and alternative engine assets if they are part of that emitted graph; this does not eagerly load those branches in the browser. Exclude unrelated PDF Workers, Service Workers, and application assets unless actually referenced by the graph.

Generate the index before historical assets are merged. It describes only what this build's Worker references; copied historical files must not become current dependencies and receive an accidental lifetime extension.

This public asset-dependency index contains paths and digests only. It contains no deployment IDs, commit metadata, publication/retirement timestamps, environment configuration, credentials, or release reports. Existing release-metadata/configuration exclusions remain in place; Pages API responses and release preparation state stay private and temporary. The index is not fetched by application startup.

Use the original emitted paths. Identical path/digest pairs are deduplicated. Validate the current build and its complete index first; missing files, invalid executable content, inconsistent digests, or conflicting current references stop publication. A conflicting historical candidate at a content-addressed dependency path must never overwrite a validated current file: discard the candidate and warn about affected historical coverage. If historical candidates conflict at such a path without a current authoritative file, omit the ambiguous path and warn. Normal replacement of a mutable entry by the current entry is expected and does not itself generate a historical-conflict warning. Verify that the current dependency set remains intact in the final staged output.

### 2. Retain resources using existing Pages deployment snapshots

Use the selected environment's existing Pages project and API credentials. Do not introduce R2 storage, a new Pages project, a cache service, or an Actions artifact store as the authoritative history.

At release preparation time T, use a rolling 7 x 24-hour window and list and paginate successful production deployments. Use the deploy stage's successful completion time, not creation time or the overall GitHub Actions job result. Select:

1. Every successful production deployment completed in the preceding 7 days.
2. The immediately preceding successful production deployment before that window.
3. The currently canonical production deployment, regardless of its age.

The predecessor is necessary: a runtime built months ago may have remained active until yesterday. Keeping only builds created in the last 7 days would remove it too early. The current canonical deployment also prevents long periods without releases from expiring the active runtime.

For each selected snapshot, fetch its current-runtime index from the unique deployment URL returned by Pages, not a mutable branch alias or the production custom domain. Retrieve the listed original bytes from that same snapshot. Merge their hashed dependencies into the staged current build at the exact original paths, so browser requests continue to use the original production origin. Keep the new build's bytes for a mutable entry path such as worker-v4.js; an old entry already running or cached can still request its retained hashed dependencies. Preserve a distinct retained root path when a selected historical runtime has one, with mutable-entry caching.

With accessible, valid history, this selection preserves a replaced runtime for at least 7 days after the successful publication that replaced it. Historical failures reduce that coverage and are reported without blocking publication. Repeated releases of the same runtime extend its actual active period, while merely carrying old files forward does not renew their lifetime. Expired assets become eligible for omission during a subsequent deployment; no scheduled deletion job is needed.

Example: A was published on day 0 and replaced by B on day 60. A release on day 65 selects A for retention even though its build is 65 days old; verified recoverable dependencies are retained and any recovery gaps are warned. A release on day 68 can omit A-only dependencies because A has been replaced for more than 7 days, provided no current or other eligible runtime references them.

Keep snapshots in the window and its boundary predecessor accessible to maximize coverage. Historical listing/pagination failures, unavailable snapshots/indexes, resource download failures, or invalid historical content produce non-blocking warnings; continue with independently verified resources from the history that was discovered. Even if no historical files can be recovered, a valid current build can proceed. Do not invent an empty history or claim complete coverage when discovery failed.

Emit GitHub Actions warning annotations and a release-summary section containing the affected historical deployment/runtime when known, sanitized asset path when known, and failure category. Report current/retained/expired counts and bytes, known missing or skipped resources, and unknown coverage when discovery/inventory is incomplete. Keep raw API responses, tokens, and resource bodies out of diagnostics. Historical warnings alone do not fail the job or require a manual override. Preserve the original snapshots for another bounded attempt on the next normal release; do not add a background repair service or extend the retention window.

References: [Pages project/deployment metadata](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/) and [deployment-specific URLs](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

### 3. Validate downloaded assets and bootstrap legacy deployments

Validate the asset index once at its download boundary. Accept only the expected schema, normalized in-scope asset paths, and digests. Fetch only from the selected project's validated HTTPS deployment URL, without forwarding the Cloudflare API token to static asset requests. Reject redirects, HTML bodies, missing files, invalid JS/WASM, and digest mismatches as historical candidates before staging them. Rejection means skip the invalid candidate and warn, not fail the current release. Continue collecting other valid historical files and mark any runtime with a missing or unresolved dependency as partially recovered or unknown, never fully covered. Use the existing bounded request/error-reporting conventions and never print raw Pages project responses.

For the initial selected snapshots without an index, derive a legacy inventory from their actual worker-v4.js bytes. Parse, never execute, the known emitted static import/export statements, literal dynamic imports, and static asset URLs relative to import.meta.url. Support the observed nested new URL expression used for WASM. Ordinary dynamic business/API fetches are not module dependencies and must not be treated as missing assets.

This bootstrap handles the verified legacy build shape only. An unresolved module/asset expression, missing bytes, or HTML response produces a historical coverage warning and does not block publication. An exact original published artifact can supplement recovery when already available; obtaining it is not a release prerequisite. Rebuilding the old source with today's toolchain is not evidence of identical historical bytes. Record recovered resources and known/unknown gaps in implementation validation and the release summary, without publishing release metadata as static assets.

The first managed release records the recovered baseline and gaps, including gaps inside the 7-day target. Historical gaps are allowed by the chosen policy and never count as complete retention. The new build's own resource set must still be complete and valid; a historical warning cannot excuse a current-resource defect. Inspect the specific incident deployment when accessible. Source collection or non-production publication requires the corresponding authorized environment; this proposal does not authorize production deployment.

### 4. Correct cache policy without changing Worker identity

For the mutable PowerSync entry paths and powersync-assets.json, generate:

`Cache-Control: no-cache, max-age=0, must-revalidate`

Keep normal ETag/304 validation. Keep immutable caching for hashed JS/WASM and unrelated hashed application assets. No query-string timestamp, per-Web-release Worker name, or new content-hashed entry is introduced.

Cloudflare Pages combines matching header values. Detach the inherited immutable Cache-Control before applying the entry/index rule, or generate equivalent non-conflicting rules; verify the effective response rather than assuming specificity wins. Author this in source configuration/generation, never by editing generated output manually. Confirm retained files are served as static assets under the generated routing.

Revalidation applies when an entry is requested. Constructing a connection to a live SharedWorker can reuse it without refetching its script. Existing fresh one-year browser cache entries do not retroactively acquire the new policy. Successfully retained dependencies protect late requests from those old runtimes during the compatibility period; reported gaps can still leave affected old pages unable to initialize.

Reference: [Cloudflare header matching and detachment](https://developers.cloudflare.com/pages/configuration/headers/).

### 5. Preserve publication ordering and make rollback retain dependencies

Keep existing merged-PR triggers, environment/account isolation, freshness checks, serialization, config-free staging, binding preservation, final deployment confirmation, and hostname-scoped purge. Existing mandatory project/credential/binding checks and upload/purge failure behavior remain unchanged; the warning exception applies only to historical resource discovery/recovery. In particular, an existing project-identity prerequisite failure is not a historical-listing warning.

Merge only validated historical runtime assets into the new output; never copy an old server bundle, HTML, routing, headers, configuration, or release metadata over it. Handle expected historical recovery failures at that boundary; do not use blanket continue-on-error or suppress current build, validation, publication, or programming errors. After the merge, current resource integrity still gates upload.

The indexed files travel with the same Pages deployment as the current application. There is no second persistence operation after publication. If publication succeeds and cache purge fails, the job remains failed under the existing contract, but that deployment still participates in future retention because Pages confirms it was published. A failed upload does not replace the authoritative runtime history.

A rollback following the 7-day retention policy uses an approved revert/recovery change through the existing merged-PR release process. Build that reviewed revision and run the same retention preparation, including recoverable dependencies of the version being rolled back. Historical gaps warn and continue, while resource defects in the rollback build itself stop publication. This restores the selected application behavior without requiring an archived copy of the entire original server/client build. Keep the existing human-controlled release authorization and freshness checks; do not add a separate rollback command or bypass the superseded-revision check. Historical dependency bytes still come from the original Pages snapshots, not from rebuilding their source.

The recovery revision must retain the repaired index generator, retention preparation, and entry/index cache policy. Regenerate its current-only index and effective static routing/headers before publication; reverting application behavior must not restore the old immutable entry policy or remove the release repair itself.

Direct Pages pointer rollback exposes the selected old snapshot immediately and can remove assets introduced afterward. Document it as an emergency action that bypasses retention preparation, not as the routine supported rollback. After such an action, restore a managed publication of the selected runtime and report the reconstructed coverage; original history no longer fully describes the intervening serving timeline.

### 6. Repair tag transport and retain bounded recovery

Keep setup-time query-source creation and the injected adapter interface. In BookmarkCell, choose local identity props from the actual local actions/data path; REST rows retain their valid bookmark ID or supported bookmark-user ID.

In BookmarkTags, use the available local writer for local-first data. With no writer, permit REST for REST-backed data even when an adapter exists. A detail UUID alongside REST-backed article tags must not block REST. Pass a narrow explicit data-origin indicator if existing props cannot distinguish those cases; do not infer identity by UUID shape or numeric conversion.

Do not submit local-only UUIDs as REST identities, or replay a rejected local write through REST. Continue using existing authorization and endpoints. Await successful REST removal before changing displayed tags/emitting change, and retain pending additions/new-tag input when additions fail. Release loading state and reuse existing error feedback.

Preserve database filename, data-version state, pending writes, browser mode selection, and timeout/cleanup stop conditions. Replace the unconditional all-modes-failed terminal wording with local-startup-unavailable wording and the actual stop reason. Keep useful existing error context without adding a telemetry system, SDK Promise patch, or new retries.

### 7. Verify the actual release boundary

Automated coverage must include:

- Real production output remains split; its generated current-only index covers database/sync Worker dependencies, including WASM and nested/shared references.
- History selection across pages, the 7-day boundary predecessor, a canonical runtime older than 90 days, repeated identical runtimes, failed uploads, and successful publication followed by purge failure.
- Current-resource validation blocks upload for an incomplete index, missing/invalid JS or WASM, digest mismatch, or conflicting current references, including when historical warnings also occurred.
- Historical listing/pagination failures, unavailable snapshots/indexes, missing/HTML/invalid assets, conflicts, and unsupported legacy expressions warn and continue; other valid historical assets are still merged. Verify completely unavailable history permits publication of a valid current build, with unknown coverage reported.
- Warning annotations/release-summary coverage, equal-path deduplication, preservation of current bytes during conflicts, legacy bootstrap, and rollback through the same policy.
- Entry/index effective headers have no immutable value; current and retained hashed assets keep their intended cache policy.
- Tag adapter-present/null-writer cases in list and detail views, both REST identity forms, local-only guards, local writer rejection, REST rejection/no result, and read-only behavior.

Record running evidence in validation.md:

| Case | Required evidence |
| --- | --- |
| With recoverable history, load A's Worker without prefetching its SQLite dependencies, publish B with retained assets, then initialize/reopen | A's original JS/WASM URLs return matching bytes and initialization succeeds |
| With recoverable history, publish A, B, C with more than one intervening release inside the window | A still operates; validation is not limited to keeping one previous build |
| Exercise expiry with controlled release times | Recoverable active/boundary assets survive; unrelated carried assets do not receive a new lifetime |
| Republish older application through retention preparation | Valid current resources, recoverable old/new dependencies, and non-blocking warnings for historical gaps |
| Make selected historical assets or all history unavailable | New build publishes successfully; valid recoverable assets remain; CI warns and reports partial/unknown coverage |
| Remove or corrupt a dependency of the new build | Upload does not start, including when historical warnings are also present |
| Multiple tabs, suspend/resume, and pending local writes | Local operations/sync remain functional; database and pending data are preserved |
| Deliberately unavailable startup | Actual REST add/create/remove requests use valid identities; HTTP errors preserve UI state |
| Safari/mobile, hosted Extension bridge, PDF, anonymous public startup | Existing supported behavior remains intact |
| Authorized non-production Pages deployment | Inspect entry/index and old/new dependency responses after deployment and purge |

Use synthetic public configuration and a controllable local Pages-compatible server first. Do not delete the real user's database for fault injection. Record deployed artifact size/file-count growth and smoke-level cold/warm startup against the baseline; the abandoned inline-WASM performance comparison is no longer required. Do not increase timeouts to mask regressions.

## Risks / Trade-offs

- **Missing history leaves some old pages incompatible** -> keep historical recovery best effort as requested, warn visibly with coverage details, and never claim a complete 7-day guarantee for affected runtimes.
- **Historical recovery must not damage or mask a broken new build** -> keep validated current bytes authoritative and require complete current resources before upload.
- **Deployment payload grows during the 7-day window** -> preserve only Worker dependency graphs, deduplicate identical paths, report growth, and omit expired dependencies during subsequent releases.
- **Mutable entries can already be cached for a year** -> correct future responses while explicitly reporting recovery gaps and limiting retention to the agreed compatibility window.
- **Already cached HTML or an aborted Worker remains broken** -> restoring server files does not necessarily repair that existing instance; use the existing bounded REST path on new startup and document ordinary reload/reopen guidance without clearing user data.
- **Pointer rollback bypasses retention** -> use a managed republish for the supported rollback procedure.
- **Incorrect identity selection in tags** -> fix parent and child together and test REST-backed article UUIDs as well as local-only data.

## Migration Plan

1. Obtain approval of this revised proposal before implementation.
2. Implement the current-runtime validation/index, best-effort legacy bootstrap/history merge, CI warnings/release summary, targeted cache headers, tag fallback, and focused diagnostics in one task branch/PR.
3. Verify the real split build, non-blocking history failures, blocking current-resource defects, synthetic boundary/rollback cases, and running tag behavior. Record the authorized environment's recoverable legacy baseline and any gaps.
4. Obtain human hands-on acceptance and resolve the Extension version-impact requirement before implementation commit/push/handoff where applicable.
5. Release through the existing reviewed dev -> beta -> main process; humans own promotion merges. Production deployment is separately authorized.
6. Retain the Pages snapshots supporting the window. Use the managed republish procedure for rollback and verify retained old URLs afterward.
7. After the task PR merges, classify every unfinished task and archive through a separate documentation PR.
