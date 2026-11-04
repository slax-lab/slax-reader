# Implementation validation

Date: 2026-11-02. Change: `track-collection-conversion`.

## Approval and scope

The requesting human approved implementation in this conversation on 2026-11-02 and explicitly confirmed **48 hours** for subscription conversion and **30 minutes** for login diagnostics. The proposal, specification, tasks, main dictionary definitions, and Q2 plan reflect that decision.

Application baseline: `cfd51f552327edfc9d23dc00e4b1d088ec955fb3`, branch `feat/track-collection-conversion`. Analytics baseline: `e38ec3811ca255569c6adb8949def83e3c69858e`, branch `docs/track-collection-conversion`.

The implementation adds optional collection provenance, client intent/exposure observations, and public/Inbox open discrimination. Existing server authentication and subscription events remain their sole success writers. No UI presentation, accessibility, schema, dependencies, or deployment configuration changed. The `login-modal-benefits` presentation already present at the baseline is preserved; no second `web-login-modal` delta was introduced.

## Automated checks

| Command / scope | Result |
| --- | --- |
| `pnpm api -- test` | 200 files passed, 14 skipped; 2,732 tests passed, 114 skipped |
| `pnpm web -- test` | 225 files passed, 1 failed, 1 skipped; 2,575 tests passed, 5 failed, 3 skipped. See the existing-check limitations below |
| `pnpm web -- test tests/unit/composables/useAuth.spec.ts tests/unit/components/GoogleLoginButton.spec.ts tests/unit/components/Modal/LoginModal.spec.ts tests/unit/components/Collection/SubscribeCollectionButton.spec.ts tests/unit/pages/collectionAnalytics.spec.ts tests/unit/pages/authAttribution.spec.ts tests/unit/utils/analytics.spec.ts tests/unit/utils/analyticsIdentity.spec.ts` | All 68 tests passed across 8 files |
| `pnpm api -- test test/domain/collectionAuthAttribution.test.ts test/utils/deviceAlias.test.ts test/domain/freeCollection.test.ts test/domain/collectionSubscribeLogs.test.ts` | All 49 tests passed across 4 files |
| `pnpm web -- typecheck` | Passed |
| `pnpm api -- typecheck` | Passed, including shared contracts |
| `pnpm api -- gen:all` | Passed; no tracked generated-output drift |
| `pnpm api -- lint` | Passed with 0 errors and 344 existing warnings |
| `pnpm web -- lint` | 98 errors and 437 warnings remain outside the changed implementation; see below |
| ESLint on all changed Web source, tests, and runtime fixture JavaScript | Passed with 0 errors; four test `any` warnings remain |
| `pnpm exec openspec validate --all --strict` | Passed: 94 items, 0 failures |
| `git diff --check`, both repositories | Passed |

Tests were added and observed failing before implementing the corresponding behavior: server events lacked collection attribution (2 failures), Google/OAuth/modal observations were absent (4 failures), subscription intent was absent (2 failures), public opens included unavailable content and lacked `surface` (6 failures), and the callback omitted metadata (2 failures). The final targeted runs above pass.

The server tests exercise the actual public `UserService.userLogin` path with synthetic provider and repository boundaries. They verify new versus returning accounts, absent/malformed/oversized attribution, unknown-key stripping, Apple exclusion, server-controlled identity, failed authentication, alias writes, and a failed stream that must not fail login. Existing collection suites cover successful writes, rejection/failure, and canonical server ownership. External Google and database integration are not implied by these tests.

## Existing-check limitations

The full Web suite's failures are all in the unchanged `tests/unit/composables/useSlaxRoutes.spec.ts`:

- `snapshotRoute > 优先用 bookmark_user_uuid 跳 /b/[id]（REST 列表形状，uuid 优先于 id）`
- `snapshotRoute > 无 id（搜索结果形状）时回退 bookmark_user_uuid`
- `highlightRoute > 所有来源统一跳 /b/{source_id}，带 highlight 查询参数`
- `highlightRoute > REST 列表形状：优先用 bookmark_user_uuid（source_id 为编码 id，非 uuid）`
- `Nuxt 自动导入覆盖：#imports 解析到 fork 版` — timed out at 10 seconds in the full run.

The first four expect URLs without `_slax_entry`, while the unchanged baseline `useSlaxRoutes.ts` deliberately decorates routes from the bookmark list. Both source and test files are identical to HEAD. The timeout is recorded as unresolved; this change does not claim an independently green baseline suite. These unrelated routes were not rewritten to make this analytics change green.

The full Web lint has existing import-order errors outside the touched files. The implementation's own import/format issues were fixed and the entire touched Web set passes ESLint. Full-repository lint cleanup is outside this change. API warnings and the skipped external/database integration tests are also disclosed rather than counted as passing tests.

## Running-environment evidence

Used a Nuxt development server on `http://localhost:3215`, a local fixture ContentEntry Worker on port 8799, and headless Chrome. The committed [fixture instructions](../../../apps/web/tests/fixtures/collection-analytics/README.md) contain the exact startup commands. No real Google account or production subscription was used.

Commands:

```sh
node apps/web/tests/fixtures/collection-analytics/browser-check.mjs
python3 apps/web/tests/fixtures/collection-analytics/query-fixture.py
```

Observed in the real browser:

- SSR/hydration produces one usable public open; pagination produces no extra open. Different collection, re-entry, and reload produce new opens. Missing and closed presentations produce none.
- A real subscribe click records intent, then the visible modal records exposure. Dismissing and reopening yields two genuine clicks and two modal views.
- Google activation records exactly one contextual click before navigating; the existing global listener does not duplicate it. Apple remains available.
- The real `/auth` page sends the original four-field provenance to the fixture login endpoint and preserves the subscription return target.
- The initiating event and callback request retain the same nonempty device ID on this local origin. Automatic subscription sends one request without a third subscribe click. No client authentication/subscription success event is invented.
- Final browser result: PASS, 6 public opens across the exercised entries, 2 subscription clicks, 2 modal views, 1 Google click, 1 login request, 1 automatic-subscription request, and no browser errors.

The fixture initially omitted the legacy `/m` heartbeat, so the local API rejected the synthetic token with 401 and the existing request interceptor cleared the session. A cookie-removal stack located that failure at `dashboard-metric.client.ts`; intercepting `/m` in the fixture fixed the smoke without changing production behavior. During investigation, candidate fixes were route coverage, complete identity/refresh responses, worker interception, and waiting for profile readiness. [Playwright's network mocking documentation](https://playwright.dev/docs/mock) informed the fixture boundary; this was not an application authentication fix.

The in-memory SQLite metric fixture passes the inclusive 48-hour and 30-minute cutoffs, new/returning login events, three duplicate deliveries, repeated visits, immature cohorts, and authenticated/Inbox/legacy/missing-device exclusions. It verifies the documented calculation boundaries on hand-checked rows, not a production warehouse report.

## Review and release scope

An independent read-only reviewer performed Bugs, Security, and Compliance passes against the approved change. Result: no Important findings and no Nits. The local final pass also found no Important implementation issue. The review deliberately did not assert production OAuth identity continuity, warehouse ingestion, or the final check outcomes; those are recorded here with their actual status.

CLI, Extension, and Mobile have no shipped behavior or package-output changes: the shared addition consists only of erased TypeScript types, and the optional API metadata preserves existing callers and response shapes. No version increment is applicable to those applications. Only Web and API behavior changes; no application version was changed.

No visible or accessibility-affecting UI change is introduced, so the DESIGN.md material-UX demo and human visual acceptance steps do not apply. Handbook C5 analytics acceptance still applies before lifecycle promotion to live.

## Remaining evidence and delivery

Companion draft PRs: [application #473](https://github.com/slax-lab/slax-reader/pull/473), targeting `dev`, and [analytics #1](https://github.com/slax-lab/slax-reader-event-tracking/pull/1), targeting `main`. Both carry the approved scope, local evidence, and outstanding acceptance work. They are not merged or deployed.

- **4.3, warehouse:** not performed. These local changes have not been deployed and no corresponding real `logs.events` rows or snapshot IDs exist for this verification. No warehouse access or production data query was used.
- **4.4, production report:** the deterministic query fixture passes, but a Q2 report over ingested real events, actual UA bot classification, and field completeness remains pending deployment and warehouse evidence.
- **4.5, analytics acceptance:** Alex's post-test-deployment acceptance under handbook C5 remains pending. C5 live acceptance has not been obtained. The six verified event writers are `implemented` in the main dictionary; no event has been promoted to `live`.
- **Production OAuth:** the actual configured public/callback origins, Google consent/new-account/returning-account exchanges, and cross-origin device continuity remain unverified. The local browser uses synthetic HTTP responses; API tests cover both success facts separately. This gap does not authorize a cross-origin identity redesign.
- **5.5, archival:** deferred until the implementation PR merges; then classify unchecked tasks and archive through the required docs PR. The analytics plan remains active until its own live/acceptance obligations are satisfied.

No deployment, merge, or production account/subscription mutation was performed.


## 2026-11-03 reviewer follow-up

The requesting human authorized addressing all feedback in event-tracking PR #1 and synchronizing PR #473, including replying to the reviewer. The event-tracking handbook now has a single main definition and event-level lifecycle; decision/approval history is in `decisions/Q2-合集订阅转化.md`. Its six event writers are `implemented` based on the existing code and local evidence, with platform/carrier coverage and pending C5 acceptance in the Q2 plan. No property-level lifecycle or duplicate amendment appendix remains.

The application proposal/design/spec/tasks now match the approved separate first-click conversion contract. The query fixture verifies first rather than last click, identity fixed at that click, inclusive 48-hour endpoints, full maturity for both counts, same device and collection, a preceding public open in the reporting interval, unknown/missing-dimension exclusions, zero-denominator unavailability, and duplicate replay invariance. It also retains the original visit and 30-minute login checks. The hand-authored expected click cohort has 9 mature browsers: 8 anonymous with 3 conversions, and 1 authenticated with 1 conversion; a converted immature browser is excluded from both primary counts.

This follow-up changes documentation and a synthetic query fixture only. There are no Web/API runtime, UI/accessibility, schema, generated-output, dependency, or shipped-package changes. Documentation/test-only verification and version exemptions apply; the earlier browser and application test results are historical evidence, not rerun results. No production query or real account flow was performed. The fixture is not production warehouse SQL and does not model actual ingestion lag, raw-UA bot classification, or timestamp-skew correction.

Checks executed for this revision:

- `python3 apps/web/tests/fixtures/collection-analytics/query-fixture.py`: both the original visit/login checks and the new first-click checks passed.
- `pnpm exec openspec validate --all --strict`: 94 passed, 0 failed.
- One-off documentation checks: local Markdown links and table widths passed; six canonical event rows are unique and implemented; all existing APP control registrations remain; Q2 approval/history text is absent from the handbook and retained in decisions.
- `git diff --check`: passed in both repositories.

Warehouse/report/C5 tasks remain unchecked; documentation restructuring is not live acceptance.

An independent read-only Bugs/Security/Compliance review of the follow-up found no Important issues. One Markdown table delimiter Nit was fixed and rechecked. The reviewer independently ran the query fixture successfully and confirmed dictionary/plan/spec consistency; production and warehouse acceptance were not judged.

Delivery: event-tracking PR #1 was updated at `3abf831`, application PR #473 was synchronized at `a38e9861`, and both PR descriptions were updated. The authorized [reviewer reply](https://github.com/slax-lab/slax-reader-event-tracking/pull/1#issuecomment-6592179741) addresses all four blockers and both suggestions and requests re-review. The reviewer has not yet approved these revisions; live/C5 and post-merge archival tasks remain pending.

## Archive classification (2026-11-04)

The merge-triggered archive evaluation reassessed the merged `dev` state, not the original task session, and classified every task in `tasks.md`.

- **Source and identity.** PR #473 (`feat/track-collection-conversion`) was merged into `dev` by `DGuang21` at 2026-11-04T03:27:22Z (approved at 03:27:15Z). Its body carries exactly one `OpenSpec: track-collection-conversion` line, and the body is not `OpenSpec: n/a`. The evaluation checkout (`bd91a26`, the `dev` tip at evaluation start) contains the merged change directory and the shipped implementation (`packages/contracts/src/events.ts` `CollectionAuthAttribution`, `apps/api/src/domain/user.ts` `auth_attribution` parsing and success-event enrichment, `apps/web/tests/fixtures/collection-analytics/`), so the merged state is the input.
- **Task 5.5 — completed, checked off with archive evidence.** Its post-merge condition holds: the task PR is merged, the remaining unchecked items are classified below, and the capability was synchronized and archived through this documentation pull request. The analytics Q2 plan lives in the companion repository and was not archived here; its own all-live/no-pending-work lifecycle condition is not yet satisfied, as the task requires.
- **Tasks 4.3, 4.4, 4.5 — preserved unchecked as accepted historical gaps.** They require a deployment, real `logs.events` ingestion, a production Q2 report, and handbook C5 analytics acceptance, none of which existed at implementation time and none of which this archive evaluation can perform. They stay unchecked and are not claimed as completed work. The acceptance record is: the requesting human's 2026-11-02 approval of the proposal, whose "Approval and delivery" section states that "live warehouse acceptance and deployment are separate evidence and delivery steps"; `design.md`, which states that "Missing live access is an explicit gap, not a live status"; and the automated review on PR #473 (2026-11-04) recording 4.3, 4.4, and 4.5 as "declared gaps, not findings" immediately before the human approval and merge. The delta spec itself defines this terminal state: its "Implementation exists without warehouse evidence" scenario requires recording the gap and withholding `live` lifecycle status rather than promoting events without evidence.
- **Tasks 1.1–4.2 and 5.1–5.4 — already checked, evidence unchanged.** No historical acceptance gap among them was left unchecked, and no completed work is claimed without the evidence above.
- **No same-capability conflict.** `npx --yes @fission-ai/openspec@1.13.1 list --json` showed 37 remaining active changes after this archive; none carries a delta for `collection-conversion-analytics` and none references `track-collection-conversion` or declares an archive order against it. `login-modal-benefits` owns `web-login-modal` and is untouched by this delta, as the proposal states. No sequence had to be honored and no requirement text was invented or force-merged.
- **Nothing dropped or narrowed.** No task was checked off, removed, or reworded to clear the archive.

## Archive outcome (2026-11-04)

- **Command:** `npx --yes @fission-ai/openspec@1.13.1 archive track-collection-conversion --yes` reported `Task status: 18/22 tasks`, the expected warning for the four then-incomplete tasks, `collection-conversion-analytics: create`, `Totals: + 7, ~ 0, - 0, → 0`, and `Change 'track-collection-conversion' archived as '2026-11-04-track-collection-conversion'`.
- **Spec updates:** created the living capability `openspec/specs/collection-conversion-analytics/spec.md` from the delta with all seven requirements — "Distinguishable public collection opens", "Anonymous sign-in modal observation", "Google intent is attributed independently of authentication", "Server-confirmed authentication preserves optional collection attribution", "Subscription intent and outcome remain separate", "Reporting uses documented identity and observation boundaries", and "Analytics changes are additive and verifiably live" — with their scenarios. No existing living spec was modified, removed, or renamed.
- **Task classifications:** 5.5 checked off with the evidence above; 4.3, 4.4, and 4.5 left unchecked as the accepted historical gaps described above; 1.1–4.2 and 5.1–5.4 unchanged.
- **Validation:** `npx --yes @fission-ai/openspec@1.13.1 validate --all --strict` printed `Totals: 102 passed, 0 failed (102 items)` with exit 0 after the archive; `git diff --cached --check` printed no output with exit 0 on the staged archive result; `git diff --cached -M --name-status` lists exactly the six `R100` renames of this change directory into `openspec/changes/archive/2026-11-04-track-collection-conversion/` plus the one added `openspec/specs/collection-conversion-analytics/spec.md`, with no other path.
- **Remaining review considerations:** the archived delta describes the merged Web/API instrumentation at `implemented` lifecycle status. Production deployment, real Google authorization and deployed-origin device continuity, warehouse ingestion and deduplication checks, the production Q2 report, and handbook C5 analytics acceptance remain unverified and are not implied by this archive; the six event writers stay `implemented` rather than `live`. The merge of this archive pull request is a human decision.
