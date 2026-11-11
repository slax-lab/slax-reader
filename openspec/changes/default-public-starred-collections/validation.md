# Validation

## Automated checks

- `openspec validate default-public-starred-collections --strict`: passed after the final requirement revisions.
- API targeted tests: 43/43 passed for default provisioning, existing visibility controls, owner responses, and authentication integration.
- API real PostgreSQL integration: 1/1 passed using an isolated local database. Eight concurrent provisioning calls returned one row and one stable code; a subsequent explicit close remained closed after provisioning.
- API full suite after merging `origin/dev`: 3796 passed, 120 conditionally skipped (242 files passed, 16 skipped).
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: passed with the repository's existing warnings and no errors.
- `pnpm api -- build`: passed using the documented non-secret local API configuration; Wrangler dry runs completed without deployment.
- No schema migration was introduced. Direct Prisma `migrate diff` against the fully migrated isolated database reported an empty migration. The interactive `gen:diff` name prompt was stopped without creating a migration; no schema or generated-artifact diff resulted.
- Web targeted suites: 135/135 passed for direct sharing, management, first-star discovery, account isolation, and CursorToast behavior.
- Web full suite after merging `origin/dev`, under the documented Node 22 environment and public placeholder configuration: 2767 passed, 3 skipped (236 files passed, 1 skipped).
- `pnpm web -- typecheck`: passed under the same documented environment.
- `pnpm web -- build` with the same public placeholders: passed.
- Changed Web files passed targeted ESLint. Full Web lint remains red on 91 import-sort errors in unrelated files; the changed-file lint result is clean. This is recorded as an unrelated existing failure, not claimed as a passing check.

## Runtime verification

A local Nuxt page and Worker fixture exercised the actual Web implementation with synthetic accounts and intercepted browser API responses. The first run found two defects that unit tests had missed: the first-star helper lost its Vue context after the star write, and the action-capable CursorToast collapsed to a one-character-wide column. Both were fixed and the scenarios were rerun.

Final fixture result: 60/60 checks passed, including fixed collection entry at zero/few stars, stable copy/view behavior, empty and closed public states, no implicit reopen, A/B account address isolation, first-star cue presentation near the actual star control, `/mine` refresh, per-account browser marking, approximately four-second duration, and view-collection navigation. The cue measured 176×40px at both 1200px and 320px and remained readable and within the viewport.

Evidence is under `test-results/default-public-starred-collections/`, including `verification-report.json`, `verify.mjs`, and before/after screenshots. These are synthetic local fixtures, not real Google authentication, production data, or warehouse evidence. `/b/[id]` and article-detail entry points share the corrected composable but were not separately browser-tested. The runtime exercise used the REST fallback rather than real PowerSync transport; local-first star writes are covered by component tests. Only the light theme was exercised in the fixture; dark/e-ink behavior remains for hands-on review.

## Additional regression investigation

The local fixture initially rendered snapshot metadata as collection JSON, which omitted the owner role and bookmark identifiers and hid owner-only snapshot controls. A separate owner-role snapshot exercise confirmed that star, archive, share, more, and side-panel controls render and work with the corrected synthetic metadata. No toolbar, sidebar, or permission-condition product code was changed by this change; this was a fixture limitation rather than a product regression.

After layout feedback, the collection entry was tightened: subscriber count again sits with the collection name, empty descriptions do not reserve a row, and the exposed link remains low-emphasis and truncated. The follow-up runtime layout check passed 28/28 assertions at 1200px and 320px, including copy/view behavior and no horizontal overflow.

The acceptance fixture was then repaired so the list-linked snapshot has an owner role, stable bookmark UUID, source metadata, and an actual local R2 article body. A real SSR/browser exercise passed 15/15 checks for title/source/body rendering, star/archive/share/more controls, side panels, and the first-star cue on the snapshot page. This confirms that the earlier blank `undefined` page was the invalid fixture response, not the deliverable's behavior.

## Full-stack acceptance environment

The fixture above is interaction evidence only, not a local full-stack claim: most browser `/v1/**` calls were fulfilled with synthetic responses. A separate full-stack environment was then prepared and used for acceptance evidence.

The full stack runs the actual API Edge/Core entrypoints, PostgreSQL 17 with real main/logs migrations, PowerSync services with isolated locally generated keys, and Nuxt with `DWEB_API_BASE_URL` pointing to the real local Edge. Browser business `/v1/**` calls are not intercepted or mocked. The environment uses a local synthetic account and locally generated JWT, not real Google login or production credentials.

Verified through real HTTP, database reads, and browser interaction:

- `/v1/collection/mine` provisioned an open collection when none existed and returned the same code on retry.
- Explicit close made `/mine` return `status=0` and the public page closed; explicit reopen restored the same code. Ordinary `/mine` reads did not reopen it.
- Star and unstar writes changed PostgreSQL state and collection counts; public collection membership changed accordingly.
- The real Nuxt first-star action showed the anchored cue without browser route mocks, wrote the account-local flag, and updated the real collection.
- PowerSync connected successfully, issued a sync token, and accepted a real sync write.
- The public collection page rendered the expected current starred bookmarks through Edge/Core/PostgreSQL.

Evidence is under `test-results/default-public-starred-collections/real-stack/`, including `web-check.json` and screenshots. No remote deployment occurred. Test bookmarks are synthetic PostgreSQL rows rather than crawled articles, so real article-body snapshot coverage is not claimed. Mobile/Extension cross-device sync and production behavior are not covered.

## Approved first-star entry guidance

The approved follow-up demo was implemented: the cue now opens `/bookmarks?filter=starred`, not the public collection directly. The starred-list collection area preserves the original hierarchy and uses the default explanation `星标会自动组成推荐阅读页，可复制链接分享。` when no custom description exists. The CTA no longer performs a dedicated `/mine` refresh; entering the starred list loads collection data once through the collection card as expected.

Full-stack checks passed 70/70 for Chinese and English cue presentation and navigation at 1200px and 320px, plus 67/67 for default/custom collection descriptions, stable copy/view, closed-state preservation, and explicit reopen. The action remains normal weight with no underline, stays on one line, and disappears after about four seconds. Real star writes and PowerSync remained active. Evidence is under `test-results/default-public-starred-collections-real-stack/`.

## Closed-state and narrow-viewport corrections

After reviewing the original interaction and reference image, closed collections now use only the original single-line mini entry rather than an initial-enablement form or a management-only action. “重新开启合集” directly reopens the existing collection with its original code and no setup form. There is no full guidance card, dismiss flow, Manage action, share/view action, or initialization form in the closed state. Narrow screens preserve the single-line treatment by ellipsizing the explanatory copy without clipping the CTA. Final runtime checks passed 160/160 for mini presentation, direct reopen, stable links, and no implicit reopen during ordinary reads.

The first-star cue now reserves the sticky-header safe area and moves below the triggering control when the top position would be obscured. A separate zero-width regression introduced by a percentage max-width constraint was found in runtime testing and corrected with a positive pixel-based width resolver. The final runtime check passed 76/76 for Chinese and English at 1200px and 320px: visible text, single-line normal-weight action, no clipping, and correct placement. Final full-suite result after these corrections is 2766 passed, 3 skipped.

## Delivery review corrections

The local Bugs/Security/Compliance review led to final hardening: generated acceptance JWT/cookie files and local signing configuration were removed from untracked evidence; collection cache now clears on accountKey changes, coalesces same-account refreshes, and ignores stale responses; reopening preserves an explicit zero status; the unused article-detail star handler and its `/mine` prefetch were removed; CursorToast containers are scoped to their parent; and collection-card styles no longer leak globally. `/mine` now returns an existing row before attempting creation, avoiding an upsert on ordinary reads. Management close/reopen also refreshes the shared cache so SPA navigation cannot show stale visibility. Real request counts confirm one initial request, no duplicate on same-account refresh, and one new request after account switch. The version decision and the requester's explicit approval of the OpenSpec writing rules are recorded above. No Important findings remain after these corrections.

## Merged-baseline runtime and 768px correction

The merged full-stack exercise also verified snapshot session recovery, account switching, dark/e-ink, and the original mini entry. At exactly 768px, the existing layout failed to switch to a block layout, allowing the full-width sidebar to cover the main content. An explicit block rule in the existing 768 media query restored the intended top navigation row and full-width main column. After the correction, the 768 layout check passed 19/19 and the cross-width first-star cue check passed 122/122. The earlier 146/146 mini result was superseded by 160/160 after final alignment.

## PR follow-up merge and lazy page extraction

After task PR #562 opened, `origin/dev` advanced and extracted the bookmarks page implementation into the lazy-loaded `BookmarkList/BookmarksPage.vue` component. The conflict resolution kept that upstream page structure, moved the collection prompt's reviewed unknown-count behavior into the extracted component, and retained the existing collection prefetch. No product interaction was redesigned in this merge.

The merged result passed the full Web suite with 2781 passed and 3 conditionally skipped tests (237 files passed, 1 skipped), Web typecheck, production build, and targeted ESLint for both the page entry and extracted component. `openspec validate --all --strict` passed 124 items with 0 failures.

The actual local full stack was exercised again after the lazy-component merge. Closed-state presentation and direct reopen passed 160/160 checks at 1200px and 320px in Chinese and English. Real first-star writes and cue placement passed 76/76 checks at the same widths and languages. Business `/v1` APIs were not mocked. Evidence files use the `-post-refactor` suffix under `test-results/default-public-starred-collections/real-stack/`; generated token files were removed after the run.

## Human hands-on acceptance

On 2026-11-10, the change requester completed hands-on acceptance of the implemented change in the real local full-stack environment and explicitly confirmed “我验收通过。” The accepted behavior includes default public provisioning, preserved closed state, original collection presentation, first-star discovery with starred-list navigation, direct sharing, snapshot controls, and responsive layouts. Acceptance followed adjustments to collection UX, cue placement and copy, closed-state mini entry, and narrow-screen clipping. The requester subsequently reviewed both dark and e-ink themes and confirmed they meet expectations. On 2026-11-11, after `origin/dev` was merged and the 768px layout correction was verified, the requester again confirmed acceptance of the merged implementation. No further adjustments were requested at acceptance.

## Commands, baseline, and rollback

### Commands and observed results

- Conflict verification: `git rev-list --left-right --count origin/dev...HEAD` returned `91 1`; `git merge-tree --write-tree HEAD origin/dev` reproduced the three conflicts. They were resolved and merge commit `1b59c746` was created.
- API targeted: `pnpm api -- test test/domain/defaultCollectionProvisioning.test.ts test/domain/freeCollection.test.ts test/domain/collectionAuthAttribution.test.ts` passed 60 tests after conflict resolution.
- API full checks: `pnpm api -- test`, `pnpm api -- typecheck`, `pnpm api -- lint`, and `pnpm api -- build` were run on the merged branch.
- PostgreSQL integration: `RUN_PG_INTEGRATION_TESTS=1 HYPERDRIVE_DATABASE_URL=<isolated-local-database> pnpm api -- test test/infra/collectionProvisioning.integration.test.ts` verified concurrent provisioning and close preservation against the migrated local database.
- Web full checks under Node 22 and public placeholder configuration: `pnpm web -- test`, `pnpm web -- typecheck`, and `pnpm web -- build` were run on the merged branch.
- Runtime: the actual local API Edge/Core, PostgreSQL, PowerSync, and Nuxt were exercised without mocked business APIs. The full-stack check scripts and results are under `test-results/default-public-starred-collections-real-stack/`.

### Baseline

- The original task branch started at `999dc2e5`. The reviewed merged baseline is merge commit `1b59c746`.
- New-account fixture: zero collection rows and zero starred bookmarks before `/mine`.
- Existing-state fixtures: one open collection and one previously curator-closed collection, each retaining its original code.
- Non-empty fixture: two current starred bookmarks; empty fixture: zero current starred bookmarks.
- These are synthetic local fixtures, not production counts.

### Rollback

- Application rollback means deploying the previous compatible code. This change has no schema migration, so no schema or visibility restoration is required. Existing rows retain their current status; do not blanket-set collections to open or closed.
- No remote migration or deployment was performed. Any production rollback would follow the authorized release process rather than modifying data to match an assumed prior state.

## Version and delivery decisions

On 2026-11-10, the change requester explicitly approved incrementing Web from `2.0.11` to `2.1.0`. API, CLI, Extension, and Mobile versions remain unchanged. The requester also explicitly approved adding the proposal/spec writing conventions in `openspec/config.yaml`; that configuration change is intentional, not incidental. The branch was committed and pushed, then merged with `origin/dev` after the independent review. Task PR #562 targets `dev`; subsequent upstream merges were resolved and reverified on the same branch. No remote migration or deployment has been performed.
