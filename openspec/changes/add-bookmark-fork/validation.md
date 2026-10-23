# Fixed-path follow-up verification — 2026-10-23

This section supersedes older immutable-path and no-op repeat-Fork evidence below. Branch: `feat/add-bookmark-fork`; implementation base: `bce93416a49ec2bc736ee256b802a737164a580c`. On 2026-10-23 the user explicitly requested a local commit and transfer to the primary checkout for hands-on development testing, with a fresh local database setup. That earlier instruction did not constitute acceptance of the new UI guards. A later explicit owner instruction on the same date authorized pushing before their manual test; the current handoff and pending R19 acceptance are recorded below. No production deployment was performed. The existing user decision not to bump application versions still applies.

## Implemented and exercised

- Conventional HTML/text/PDF/metadata keys, embedded private media supplements, same-destination repeat Fork, guarded updates and no retired-bundle cleanup.
- Ordinary URL admission, one durable Workflow claim, accepted-request timestamps, finite retry ownership, pending rescue without stealing active writes, native PDF ownership/retry, legacy media write exclusion and old third-party queue routing.
- Historical shared relation conversion preserves personal identity/state and other owners' content. Failed old-client Reader sync entries replay without blocking an unrelated mutation in the same batch.
- Request-only frontend gates plus synced active states, account-change checks, unconditional settlement release, and no automatic client retries.

## Automated checks

- `pnpm api -- gen:all`: passed using process-only placeholder local PostgreSQL URLs and `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example`. Generated DI changes were inspected; no schema or configuration change was introduced. An initial run without datasource placeholders stopped before completion; the configured rerun succeeded.
- `pnpm api -- typecheck`: passed, including contracts.
- `pnpm api -- lint`: passed with 0 errors and 344 existing/scoped warnings; no blanket warning cleanup was performed.
- `pnpm api -- test`: final post-review run passed 191 files / 2,443 tests; 96 optional integration/sample tests were skipped. The changed Workflow cache-release behavior also passed its 79-test workflow/dispatch suite.
- Task-owned PostgreSQL runner `.superpowers/sdd/fork-fixed-paths/pg-tests.ts`: 24 integration tests passed against migrated PostgreSQL 17, including simultaneous API and sync creation, one atomic claimant, monotonic terminal timestamps, stale claims, Fork uniqueness, shared conversion/personal-state preservation, deleting-row rejection and Reader-placeholder replay. Disposable container/workspace removed.
- Podcast stale-reference race: 24 focused service tests and 2 real PostgreSQL reference tests passed after full isolated migrations; changed timestamp/key and active status cannot repoint a completed private capture. Disposable resources removed.
- Web: documented `pnpm web -- typecheck` and `pnpm web -- build` passed. Five focused files / 36 tests passed.
- Extension: documented `pnpm extension -- typecheck` and `pnpm extension -- build` passed. Two focused files / 6 tests passed. Versions unchanged.
- `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build`: offline Core, Edge, AI and Browser builds passed; Wrangler dry-run only.
- `pnpm exec openspec validate --all --strict`: 74 items passed, 0 failed.
- `git diff --check`: passed.

## Running backend and browser evidence

`FORK_SMOKE=1 pnpm api -- test:http` passed against task-owned local Workers, PostgreSQL, R2 and search storage after the fixed-state changes. It exercised article, shortcut, uploaded PDF, downloaded PDF, YouTube and podcast Forks; same-UUID/same-key repeated refresh after source mutation; source deletion; PDF range reads; media variants; attribution revocation; legacy entry points; restored search; media catch-up failures/recovery and owner recapture; fixed-key deletion; ordinary CRUD/fulltext. The runtime-only Node R2 bridge materializes response bodies for direct service checks; HTTP paths use Worker bindings. Resources were cleaned by the harness. No external provider call was made.

The actual changed Web components were exercised in a running task-local Vite fixture at `http://127.0.0.1:3099/`, with account, HTTP and synced-row boundaries explicitly mocked. The existing application theme/reset styles were loaded. Eleven grouped browser checks passed with zero page errors across light/dark/e-ink and 320/768/1280 widths: same-source buttons share a gate; another source remains usable; duplicate Enter dispatches once; modal reopen respects all three active statuses; terminal success permits deliberate refresh; failed requests release; late account completion cannot navigate. Dialog/button containment and 44px action height were checked. The fixture does not reproduce the application-generated spinner glyph or real PowerSync transport. Machine-readable evidence and restart/manual steps are in the task-local frontend report.

## Review and remaining gates

Independent review used `REVIEW.md` Bugs, Security and Compliance passes with change-id `add-bookmark-fork`. Important issues found and repaired include native PDF write ownership, orphan PDF retry, reserved versus published missing PDF handling, sync deletion races, legacy media writer exclusion, old queue writer routing, cached public-row claim release, and podcast stale reference eligibility. Real PostgreSQL testing additionally caught the Prisma relational-claim race and concurrent emulated-upsert conflicts; atomic SQL admission and a single transaction retry were verified.

Final independent review found no remaining Important code findings. Bugs/Security passed; Compliance matches the approved change subject to the acceptance gate below. The report is `.superpowers/sdd/fork-fixed-paths/final-review.md`.

**Follow-up human acceptance is pending.** The requesting project owner's 2026-10-22 acceptance applies to the previous UI, not these new guards. The fixture supplied agent-driven duplicate submission / retry / account-switch evidence. The owner subsequently requested pushing first and testing manually in the primary checkout. R15 now records completed implementation and machine verification; R19 separately retains the pending human acceptance. This permission changes the handoff order, not the requirement to record actual acceptance before merge.

Remaining scope limits: no production rollout, real provider acquisition/generation, complete ordinary Workflow execution with all remote services, full browser-to-PowerSync-to-API transport, Mobile uploader exercise, or process-kill/ambiguous-commit fault injection was performed in this round. State/retry boundaries are covered by regression suites, real database races and the local API exercise as described, not claimed as those unperformed scenarios. Fixed-key partial writes, retained uncertain files and a crashed active claim are explicit accepted design limits, not an automatic recovery guarantee.

---

## Earlier implementation evidence (superseded where noted above)

# Validation

## Implementation authorization — 2026-10-22

The user reviewed the presented scope and explicitly requested implementation ("开始施工吧"). This authorizes the all-format, online-only plan. Historical media specification synchronization/archival was prepared as a separate documentation dependency (`docs/archive-media-specs`, commit `2219c907`), preserving all incomplete historical verification records. The feature branch includes that dependency; it has not been pushed or merged.

## Planning baseline — 2026-10-22

- Worktree: `/Users/yjc/.codex/worktrees/add-bookmark-fork/slax-reader-v2`.
- Branch: `feat/add-bookmark-fork`, based on `origin/dev` at `7089a16ef1fdacb91e89bbf3465b47ff10a5598a`.
- User scope decisions: dedicated relational provenance field; all existing formats including PDF/YouTube/podcast; Fork requires connectivity, while successful bookmarks continue to synchronize through PowerSync.
- Implementation is in progress following explicit human approval. The additive migration has been applied only to a task-owned disposable PostgreSQL container. No remote deployment or application version change has been performed.

## Checks run

| Check | Result | Meaning |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Passed | New worktree dependencies installed |
| `pnpm api -- gen:model` with nonsecret loopback placeholder database URLs | Passed | Prisma clients generated without connecting to a database |
| `pnpm api -- test test/domain/bookmarkAccessSecurity.test.ts test/infra/powersyncRules.test.ts test/flow/content/contentDetail.test.ts test/flow/addUrl/3-bookmarkCreation.test.ts` | 4 files, 50 tests passed | Existing access, sync rules, detail and creation baseline |
| `pnpm exec openspec validate --all --strict` before adding this proposal | 72 passed, 0 failed | Existing OpenSpec baseline |
| `pnpm exec openspec validate --all --strict` after preparing this proposal | 73 passed, 0 failed | New artifacts and existing inventory structurally valid |
| Local Markdown-link check across the feasibility document and change artifacts | 7 documents, 0 broken local links | Review navigation resolves within the worktree |

The first focused test invocation could not load three suites because Prisma clients had not yet been generated in the fresh worktree. Generation resolved that setup issue; the complete retry passed. No source fix was needed.

## Review evidence

The earlier feasibility review identified source UUID reuse, asynchronous deletion adoption, unknown-commit cleanup, sync failure semantics, shared-SSR identity leakage and omitted import/Telegram entry paths. The formal design includes remedies and acceptance scenarios.

Two read-only format investigations additionally identified PDF insert-trigger metadata loss, uploaded-PDF identity, bodyless shortcuts, shared-media fan-out, fallback articles/translations and moderation/takedown references. These are included in the formal design. Planning review does not establish implementation correctness.

Two subsequent read-only reviews found four Important planning issues: same-URL/different-client-UUID failed placeholders, source `show_userinfo` disclosure, takedown/publication races, and contradictory active media requirements. The design/specs/tasks now include deterministic per-client placeholder identities, explicit identity visibility, a media-policy publication/read barrier, and unconditional sequential spec reconciliation before managed-media implementation. Both reviewers rechecked the revisions and reported no remaining Important findings in those revisions. The media reconciliation prerequisite was completed against the archived living baseline. Two scoped MODIFIED deltas were added within this change, preserving the original scenarios.

The scoped reconciliation review found two further contradictions: Labs-off reads of saved variants, and visitor status for frozen podcasts. Both were corrected and independently rechecked with no Important findings remaining. This was a specification review, not a code review. Strict validation after reconciliation passed 72 items with no failures.

## Current runtime and release status

The real local HTTP exercise has passed against Edge/Core Workers, historical PostgreSQL/D1 migrations and local R2. Browser Fork creation, duplicate navigation and attribution have been exercised. The responsive/theme matrix, all-format browser navigation and PowerSync library synchronization passed. Extension saved-state integration passed after the bridge-session authentication fix. The requesting project owner confirmed hands-on UI acceptance on 2026-10-22; no production resources were accessed. No PR, deployment or application-version change has been performed.

## Implementation checkpoints — 2026-10-22

- Task-owned PostgreSQL: `slax-bookmark-fork-db`, loopback port `55439`, isolated `slax_reader` database. Existing developer services were not modified.
- Schema sequence: `pnpm api -- gen:diff` generated `20261022053704_add_bookmark_fork`; inspected SQL contains one nullable-column addition. `pnpm api -- migration:local` and `pnpm api -- gen:all` passed with disposable local database URLs and the public Cloudflare template.
- Reader classifier: 16 tests passed. Immutable bundle tests: 3 passed. PostgreSQL lifecycle/sync tests: 6 passed. Fork controller: 3 passed. Private media pure-state/service tests: 6 passed.
- At the 14:22 checkpoint, 8 targeted API files / 130 tests passed, covering the Fork service (9), private media, cleanup, legacy YouTube/podcast behavior and capture adapters. This is checkpoint evidence; subsequent changes still require fresh checks.
- Web authoritative-body-pointer/PDF SSR and neutral Fork attribution: 2 files / 11 tests passed before subsequent media and bridge work.
- Additional regression cases exposed a frozen-podcast polling bug and unnecessary Extension Reader-shell capture; fixes are in progress and are not yet recorded as verified.
- Typecheck passed at the intermediate provider/capture checkpoint. Generator output must be refreshed and all required final checks rerun after implementation settles.
- At this intermediate checkpoint no human UI acceptance or application-version decision had been requested. The later version decision is recorded below.

## Final-check checkpoint — 2026-10-22

| Command / exercise | Result |
| --- | --- |
| `FORK_TEST_DATABASE_URL=<task-owned loopback DB> pnpm api -- test` | 188 files passed, 12 skipped; 2,370 tests passed, 71 skipped. Includes 11 real PostgreSQL Fork publication/lifecycle tests. Skipped suites require separate existing fixtures/services. |
| `pnpm api -- typecheck` | Passed after provider, import and runtime changes; subsequent HTTP-header regression rerun also passed. |
| `pnpm api -- lint` | Passed: 0 errors, 341 existing warnings. |
| `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build` | Passed offline dry-run build; no remote operation. |
| `pnpm web -- test` | 220 files passed, 1 skipped; 2,508 tests passed, 3 skipped in the final rerun, including the Fork action/attribution and Extension bridge-account tests. |
| `pnpm web -- typecheck`, `pnpm web -- build` | Both passed with explicit public loopback configuration after the bridge-authentication and narrow-header fixes. |
| `pnpm extension -- typecheck`, `test`, `build` | Passed; 24 test files / 107 tests. |
| `pnpm cli -- typecheck` | Passed for additive shared-contract compatibility. |
| `pnpm --filter @apps/slax-reader-mobile typecheck` | Passed for additive shared-contract compatibility. |
| `pnpm exec openspec validate --all --strict` | 72 items passed, 0 failed after media reconciliation. |
| `pnpm api -- test test/handler/http/acceptanceResponseHeaders.test.ts test/handler/http/telegramFork.test.ts test/handler/bookmarkForkController.test.ts` | 3 files / 15 tests passed, including no-store middleware failures and Telegram encoded success links. |
| `pnpm web -- test tests/unit/composables/bookmark/useBookmarkFork.spec.ts` | 2 tests passed: offline/login/duplicate-click guards and account/route attribution invalidation with stale-response rejection. |

### Real local API/R2 exercise

`FORK_SMOKE=1 pnpm api -- test:http` passed using fresh disposable PostgreSQL, D1 and R2 state and the actual Edge/Core entrypoints. On this machine the test process used a task-owned PATH shim to the already installed pinned pnpm binary because the existing harness isolates HOME. A short owned IPC temp directory prevents macOS socket path overflow in long worktree paths.

Observed scenarios:

- HTML, bodyless shortcut, uploaded PDF, URL PDF, YouTube and podcast each created a separate private raw bookmark and user relation with relational provenance.
- Repeat Fork returned the same destination UUID and `already_saved`; source alias and star state were excluded.
- HTML text was derived from the copied body while a deliberately stale source text object was ignored.
- Uploaded PDF identity was rewritten for the destination owner while retaining the document digest.
- Reader URLs through both legacy `/add` and `/add_url` reused the completed copy and ignored supplied Reader-shell HTML.
- Attribution displayed the source owner when permitted, hid the owner when `show_userinfo=false`, and became unavailable after share revocation. Revoked source Fork returned HTTP 404.
- After deleting all source database rows and source objects, the copied HTML, PDF byte range (`206`), YouTube article and podcast translated paragraphs/timestamps remained readable.
- Existing authenticated CRUD, unauthenticated/spoofed-identity rejection, CORS, D1 index/changelog and deletion smoke checks also passed.

The first real request exposed the missing router-generator allowlist entry. The generator input, generated router and existing controller-list test were corrected, and the complete HTTP run passed. Two earlier seed failures involved physical Prisma-mapped table/column names; they were test harness issues and were corrected against the actual schema. An exact text assertion was adjusted to the existing text extraction behavior, without changing the source data.

### Implementation review

Independent reviewer completed Bugs, Security and Compliance passes for `add-bookmark-fork`. Five Important findings were fixed: cached Reader policy revalidation, resolved podcast acquisition gates, import personal-state publication, captured podcast input races, and Telegram success-ID encoding. Focused reviewer checks passed (25 API boundary tests, 34 import/media/Fork tests and 5 Web cache tests). Follow-up review of Telegram encoding, generator wiring, component import, cross-origin metadata requests and response cache headers reported no remaining Important findings; another 4 focused files / 26 tests passed.

Browser verification found missing explicit `SnapshotForkButton` import (only global components are automatically imported) and an unnecessary metadata request `Cache-Control` header blocked by CORS. Both were corrected. The API response retains `private, no-store`; the cross-origin browser now renders `Fork: Owner` with the source link. Middleware-level failure responses also receive no-store.

### Remaining acceptance evidence

- Real runtime fault injection for lost COMMIT acknowledgement has not been performed; service-level injected commit-then-timeout and unknown-outcome tests passed, and PostgreSQL concurrency checks passed.
- Live external YouTube/podcast generation providers are not used: deterministic saved artifacts exercise copy/read behavior without billable provider requests.
- The requesting project owner confirmed hands-on UI acceptance on 2026-10-22. The user explicitly declined the Extension version bump on 2026-10-22; Extension stays at 1.16.3. CLI stays at 1.0.2 and Mobile at 1.0.25/build 783 because the additive contracts do not change their shipped behavior.

### PowerSync runtime checkpoint

After OrbStack stopped during testing, it was restarted without resetting configuration; only task-owned containers were started. The PostgreSQL dynamic loopback port changed, so only the disposable Core configuration was updated. A separate task-owned PowerSync service uses the repository's public sync rules unchanged and a freshly generated local fixture RSA key. `/probes/liveness`, actual Edge `/v1/sync/token`, and `/sync/stream` using that returned token each returned HTTP 200. A fresh browser subsequently received all six destination formats through the actual PowerSync-backed bookmark list.

### Application version decision

The affected shipped application is Extension. The user explicitly selected **no version bump** on 2026-10-22; `apps/extension/package.json` remains 1.16.3. The release workflow requires both a relevant change and a version increase on dev/beta/main, so this task does not trigger a new Extension release by itself. No browser-store upload is performed by this task. CLI 1.0.2 and Mobile 1.0.25/build 783 remain unchanged; their compatibility typechecks passed.

### Browser verification

An isolated Playwright Chrome context exercised the running Web at localhost:3009 against the real API and PowerSync services. No real browser profile was used.

- Light, dark and e-ink at 320px, 768px and 1280px: Fork stayed within the viewport with a 44px target, visible keyboard focus and no horizontal overflow. Reduced-motion preference was enabled. The initial 320px run exposed brand wrapping; the narrow header now uses the existing logo with an accessible application name and a 44px target. The Fork live region is grouped with its button to avoid an extra flex gap. The matrix passed after this adjustment.
- Guest click opened the existing login dialog. Offline click displayed the connectivity message. Repeated Fork navigated to the existing destination; its own Fork button was absent and `Fork: Owner` linked to the source.
- The actual Add URL dialog accepted a Reader PDF URL, copied it and navigated to its destination. Uploaded and downloaded PDF copies both rendered the text “Independent PDF” and the Source/Fork rows.
- YouTube and podcast copies displayed their saved article and 00:05 paragraph cue. Podcast player title/controls appeared in its shadow root; YouTube retained its transcript panel. Bodyless shortcut also opened with provenance. Fixture media URLs are not live playable resources, so external playback was not claimed.
- After navigating back to `/bookmarks`, all six destination types appeared through the real PowerSync library, including the Add URL-created PDF.
- The HTTP smoke was rerun after strengthening media fixtures to use the production body renderers and normalized cue mappings: it passed again. The API typecheck also passed.

Screenshots and automation scripts remain ignored local evidence under `.superpowers/sdd/tasks/`; they are not committed. Human acceptance subsequently occurred as recorded below.

### Additional state checks and declared runtime gaps

- At 320px in all three themes, a delayed simulated 503 response exercised the disabled `Copying…` state and announced error state. The loading button remained inside the viewport at 44px high. Successful creation/navigation was separately exercised against the real API.
- The final narrow-header, live-region and production-renderer fixture changes received an independent incremental Bugs/Security/Compliance review with no Important findings.
- An attempted ordinary inline-HTML capture exercise could not complete because this disposable HTTP harness omits the capture Workflow binding (`kickoffWorkflow` reported an absent `create`). Its isolated pending fixture was removed. Ordinary capture isolation remains covered by the automated creation/crawl/media suites; end-to-end provider/workflow capture is not claimed.
- PDF terminal extraction states and destination identity are covered by service tests; real runtime covers ready PDFs, body rendering and range reads after source deletion. Native duplicate-upload and creation of a new destination highlight after deletion were not separately driven.
- Old-client sync placeholder behavior is covered by real PostgreSQL batch/replay tests. A complete Mobile device uploader/restart/lost-ack exercise was not run in this desktop setup.

### Extension integration and bridge authentication correction

A disposable official Chromium profile loaded the locally built Extension 1.16.3 and performed two actual toolbar actions on the source Reader page. Both requests sent the original Reader URL with empty HTML content, returned HTTP 200/code 200 and the same bookmark ID, and displayed the visible `Collected` receipt. After PowerSync synchronization the bridge resolved the correct destination UUID, remained on `/x/ext-bridge`, and the badge displayed `✓`. The profile was closed and removed. This exercised duplicate destination reuse; initial Fork creation was exercised through Web and API.

The first run found an Important integration bug: the new Reader lookup used the ordinary Web request wrapper, whose cookie authentication is unavailable inside the offscreen iframe. A 401 navigated the bridge to `/login`. The fix uses the existing authenticated extension session transport, checks that its account matches the local PowerSync database owner, omits ambient cookies, rejects redirects, and discards results after account changes. A 401 yields no saved reference without redirecting the frame. The repeated real-browser run passed all assertions. Six focused regression cases passed and cover fresh-session use, absent/different/malformed sessions, an in-flight owner change and 401 handling. The final full Web rerun passed 2,508 tests and its typecheck passed after this fix.

Independent incremental Bugs/Security/Compliance review of the helper, integration and tests found no new Important findings. Extension stays at 1.16.3 as requested. Sanitized runtime results and screenshots remain local ignored evidence; no user browser profile or production service was modified.

### Pre-handoff checkpoint

Final Web test/typecheck/build completed successfully after the bridge fix; API lint again reported 0 errors / 341 warnings. Strict OpenSpec validation passed 72 items with no failures. `git diff --check` passed. The local demonstration services were restored for human hands-on acceptance. No feature commit, push, pull request or deployment has been performed.

Human hands-on acceptance was requested on 2026-10-22 after the final build and a successful demonstration restart check. The prepared local entry is `http://localhost:3008/saver`; the source Reader page is retained in the task browser. Requested steps: press Fork, inspect Source/Fork attribution on the destination, and confirm the library record. The requesting project owner subsequently confirmed: “I have tried it hands-on; it meets expectations.”

### Human hands-on acceptance — 2026-10-22 (Asia/Shanghai)

The requesting project owner explicitly confirmed hands-on acceptance in this task after using the prepared local environment. The requested exercise covered the Fork action, destination Source/Fork attribution and the bookmark list. Their response was: “I have tried it hands-on; it meets expectations.” No additional adjustments were requested. The narrow-header and bridge-authentication corrections had already been implemented and reverified before this acceptance. The separately declared runtime coverage gaps remain visible for review; this UI confirmation does not claim those unexecuted scenarios passed.

At the acceptance checkpoint, the application source was unchanged from the final passing test/build and browser/Extension runs. The subsequent upstream integration and its fresh verification are recorded below.

### Upstream integration — 2026-10-22

The feature checkpoint is `a1be9217`. Before handoff, the task branch integrated `origin/dev` at `18f0dd6c` and the reconciled documentation dependency `1041a594` (`docs/archive-media-specs`). The only source conflict was the import block in `crawl.ts`; both the private snapshot imports and upstream `FetchError` import were retained. The merged code preserves the upstream podcast provider fallback/context forwarding and media generation budget changes alongside private snapshot publication.

The historical media artifacts retain upstream follow-up edits in their archive paths. The living YouTube budget baseline is $1.00, matching the approved upstream behavior. A fresh independent Bugs/Security/Compliance review selected `add-bookmark-fork`, found no new Important code findings, and identified the stale $0.30 living baseline; integrating the reconciled documentation dependency resolved that finding.

The version decision still applies: this task makes no application version bump. Extension remains 1.16.3 and CLI 1.0.2. Mobile 1.0.25/build 784 is inherited from upstream PR #342; the earlier build 783 statement describes the pre-integration checkpoint and is not a downgrade instruction. No task changes are made to any application version manifest.

Fresh integrated-tree API and Web suites passed: API 189 files / 2,385 tests (12 files / 71 tests skipped), including 11 real PostgreSQL Fork tests; Web 222 files / 2,517 tests (1 file / 3 tests skipped). API typecheck, lint (0 errors / 341 warnings) and offline build passed. Web typecheck and build passed with the same explicit loopback configuration. The complete `FORK_SMOKE=1 pnpm api -- test:http` exercise passed again using fresh disposable PostgreSQL/D1/R2 and the integrated actual Edge/Core entrypoints. Strict OpenSpec validation passed 74 items; whitespace checks passed. Extension and shared-contract source are byte-identical to the previously verified feature checkpoint, so their passing checks remain applicable. Existing declared runtime gaps remain unchanged.

After the integrated build, the local Web demonstration was restarted and the browser exercise passed again at all nine width/theme combinations. Login, offline handling, repeat-Fork destination navigation, the owner-only hidden action and `Fork: Owner` attribution also passed. No new UI adjustment was required after the owner's acceptance. Both the feature and documentation dependency are committed locally; their repository-template PR bodies are prepared, with publication awaiting the integration choice.

### API review follow-up — 2026-10-22

The requesting owner authorized fixes for three review findings and five local simplifications after PR #354 was opened. The review baseline was `d9fe0861`; the approved OpenSpec scope and the no-version-bump decision are unchanged. No schema or client-interface change was added.

- Existing and own-source Fork restores clear search caches without replaying creation notifications or replacing content/provenance. Uniqueness-race winners use the same result path.
- Managed YouTube/podcast status treats catch-up as best effort while keeping initial private-manifest and access/policy checks fail-closed.
- Podcast input changes produce an explicit recoverable state. Only the ordinary capture's owner can adopt the current input for its pending/unavailable components; ready saved components and frozen Forks remain independent. Recovery can reuse ready canonical content or attach to existing deferred/transcribing work under the existing acquisition controls. Saved transcript cues remain intact, while recovered article paragraphs retain their own resolved times through a compatible optional renderer argument.
- Initial capture and later revision writes share one publication/reconciliation routine. Normal managed capture completion shares version-aware indexing with Fork, media and cron recovery. Request-local loaded state avoids redundant manifest reads. PDF binary copying performs one conditional read/copy. The unused podcast link flag and its CrawlService repository dependency were removed; required YouTube legacy behavior remains.

Regression evidence: the initial focused run failed five assertions covering both restore paths, both managed status paths and podcast retry availability. The corrected focused run passed; further failing-before/passing-after cases cover deferred/transcribing input recovery, stored-revision indexing, and a saved transcript at 100 ms with a newly completed article paragraph at 900 ms. The initial nine-file focused run passed 195 tests. A task reviewer then found that input recovery could overwrite a ready English variant after the owner switched their language preference; four new assertions reproduced the loss before correction. Recovery now selects an outstanding input-changed language and protects ready saved variants. Two additional failing-before/passing-after cases ensure ready-episode recovery creates or starts the requested missing Chinese component even when the current preference is English, using the existing acquisition and workflow gates. The final four-file scoped recovery suite passed 106 tests; explicit non-recovery YouTube/podcast refresh controls retain their existing behavior. Fault-injection logs represent expected failures caught by the tests, not unhandled errors.

Fresh integrated checks:

| Command | Result |
| --- | --- |
| `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=<loopback placeholder> LOGS_DATABASE_URL=<loopback placeholder> pnpm api -- gen:all` | Passed; only the intended generated DI dependency changes remain. No database mutation or deployment. |
| `pnpm api -- test` | 189 files / 2,412 tests passed; 13 files / 82 conditional tests skipped. This run did not configure the optional `FORK_TEST_DATABASE_URL` suite; its earlier 11-test evidence remains historical. |
| `pnpm --filter @apps/slax-reader-dweb test tests/unit/components/Snapshot/PodcastBar.spec.ts` | 14 tests passed against the existing rendered consumer, including retry clicks using a shared API response fixture. |
| `pnpm api -- typecheck` | Passed. |
| `pnpm api -- lint` | Passed with 0 errors and the existing 341 warnings, after correcting three formatting errors in the new statements. |
| `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build` | Passed offline builds for the Worker targets; no remote deployment. |
| `FORK_SMOKE=1 pnpm api -- test:http` | Passed on final behavior with disposable PostgreSQL, local R2/KV and actual Edge/Core entrypoints. |
| `pnpm exec openspec validate --all --strict` | 74 items passed, 0 failed after the final correction and evidence update. |
| `git diff --check` | Passed. |

The expanded running-environment smoke exercises both other-source and own-source restoration after seeding an empty valid-bookmark search cache; the stored relation becomes active and the real KV cache is cleared. A managed YouTube snapshot whose canonical catch-up object is missing still returns a successful pending status and keeps its saved pointer. Two changed-input podcast captures recover through the real retry endpoint using deterministic ready transcript/article objects. One already has a saved transcript cue at 100 ms: its recovered article renders a 5,000 ms paragraph while the private transcript cue and saved player title remain unchanged. The smoke also advances that episode to transcribing after marking a Chinese component pending, then explicitly retries with an English preference: the ready English document/content remains byte-for-byte equivalent and only Chinese reattaches as pending. The independent podcast Fork retains its original pointer. All six existing format, duplicate, attribution/revocation, source-deletion, PDF range and variant cases also passed.

No live media generation/provider requests were used. The existing declared gaps (real lost-COMMIT injection, complete ordinary capture Workflow, native duplicate PDF upload/new highlights, and Mobile uploader/restart) remain unchanged. Web/Extension components and shared client contracts were not modified in this follow-up; the prior human acceptance remains recorded above. Independent follow-up review is recorded below after completion.

The independent task review found one Important Bugs/Compliance issue in input recovery after a language preference change. The original implementer fixed it and the adjacent explicit-language start path, with failing-before/passing-after regressions. A scoped independent re-review approved Bugs, Security, Compliance and task quality with no remaining Important findings or Nits. The fresh full suite and runtime evidence above were obtained after this fix. Whole-branch pre-push review follows as a separate checkpoint.

### Whole-branch review correction wave — 2026-10-22

The independent whole-branch Bugs/Security/Compliance review found three further Important behavior gaps. A single combined fix wave addressed them without changing client presentation, contracts, dependencies, versions or database structure:

- Recoverable podcast `input_changed` components remain unavailable in the stored sidecar, but the API projects them as `failed` with `can_retry` for an acquisition-enabled ordinary owner. Existing Web failure/retry controls now render them. Visitors, frozen Forks, Labs-disabled owners and permanently unavailable components retain terminal unavailable semantics. One shared test fixture connects actual API status output to the existing mounted PodcastBar, which exercises retry clicks for transcript, original-article and translation-only recovery.
- The pending podcast input fingerprint excludes measured duration, which normal transcript completion enriches. Tests drive the actual `markReady` repository method from unknown and estimated duration to measured duration; automatic settlement completes. Title, audio URL and publisher transcript changes still invalidate pending work, and the final transactional input/hash/pointer checks remain in place.
- Managed YouTube settlement keeps a ready private supplemental variant but promotes it into the body only if current Labs enablement, current owner language and the existing marks guard allow it. Previously saved variants remain readable when settings change.

Seven new regression assertions failed before correction. The final focused API run passed 127 tests, and the Web consumer run passed 14 tests. The refreshed full API suite passed 2,412 tests with 82 conditional skips. Typecheck, lint (0 errors / 341 existing warnings), offline Worker builds and the expanded real HTTP smoke passed after the correction. The smoke now checks the public recoverable failure projection alongside stored unavailable state, automatic completion after unknown/estimated duration enrichment, and all three YouTube promotion outcomes (disabled, language changed, eligible). Blocked promotion preserves the original body while storing the ready supplemental variant. No provider request or remote deployment was made.

The review's stated runtime limitations match the previously declared gaps; none were silently treated as verified. The final scoped independent re-review marked all three findings ADDRESSED, approved Bugs, Security, Compliance and code quality, and found no additional Important findings or Nits. It confirmed the shared fixture connects the real API output to the existing PodcastBar retry interaction. The final pre-push verdict is ready to push; no Important finding remains unresolved.


### Owner recapture attribution follow-up — 2026-10-23

The requesting project owner approved changing provenance from a permanent creation marker to the source of the currently saved content: independently acquiring and successfully publishing the original resource clears `forked_from_id`. The destination UUID, personal state and source user's content remain unchanged. Failures, pending/superseded attempts, ordinary metadata changes, Reader-URL duplicates and cached PDF reuse preserve provenance. No additional schema migration, client contract, presentation component, dependency or package-version change is required; the prior no-bump decision still applies.

The implementation changes four production API files. Ordinary HTML/media acquisition opts into clearing within the existing revision-guarded publication transaction. Media acquisition already constructs a fresh `capture` manifest. Settlement and policy publication do not opt in. PDF persistence opts in only when publishing newly acquired bytes, and passes the workflow's expected revision to the transactional raw-row update. Cached extraction, duplicate native upload and title repair keep the existing file and provenance.

Regression evidence:

- Before implementation, the real PostgreSQL suite failed five cases: HTML/YouTube/podcast provenance clearing, rollback when provenance clearing fails, and independent PDF publication. The fixture was corrected to allow the existing metadata trigger to update the new content's word count while still asserting personal-state preservation.
- Independent Bugs/Security/Compliance review found a stale-PDF publication gap: an HTML Fork's original URL may become a PDF, and an old download can finish after a newer acquisition starts. A real PostgreSQL regression and a domain revision-forwarding regression both failed before correction. Publication now checks the workflow revision before updating either the pointer or provenance. Scoped re-review confirmed the finding addressed, with no remaining Important findings or Nits.
- Disposable PostgreSQL 17, created and removed by the existing `LocalResources` harness, applied all repository migrations and ran `FORK_TEST_DATABASE_URL=<owned loopback database> pnpm api -- test test/infra/bookmarkFork.integration.test.ts`: **19 passed**. This includes all eight new recapture cases, R2 write failure, lost revision race, transaction rollback, normal media publication preservation, cached PDF preservation and stale-PDF rejection. The temporary runner was not committed. No operator credentials or existing database were used.
- `pnpm api -- test`: **2,413 passed, 90 conditional tests skipped**. The PostgreSQL suite above ran separately with its opt-in database variable. `pnpm api -- typecheck` passed; `pnpm api -- lint` passed with **0 errors / 341 existing warnings**.
- Required `pnpm api -- gen:all` passed with the public `deploy/cloudflare/api.toml.example` and nonsecret loopback database placeholders. Generated output is unchanged. `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build` passed as an offline dry run.

The first expanded `FORK_SMOKE=1 pnpm api -- test:http` run passed the existing all-format checks plus independent recapture publication and HTTP attribution reads. A final repeat after the PDF revision correction stopped before HTTP setup: PostgreSQL/log migrations returned 0, while the local D1 DB migration process returned 1 despite printing its applied-migration table. The harness refused to bypass initialization and removed its owned resources. The isolated retry then timed out before database creation in `pnpm exec wrangler --version`; its Corepack bootstrap process was observed waiting on HTTPS. Following the [official Corepack offline guidance](https://github.com/nodejs/corepack#offline-workflow), candidate remedies were a longer bootstrap timeout, prehydrating each isolated cache, selecting an existing package-manager cache, or directly invoking the already-installed pinned pnpm. The final retry uses a temporary PATH wrapper for the existing pnpm 11.25.0 executable, avoiding package-manager download while retaining the harness's isolated HOME/configuration and owned databases. No tooling or configuration change was committed. Its result is recorded below. Existing gaps remain: the fixture has no ordinary capture Workflow binding, so it cannot prove a full original-URL/inline acquisition through that workflow; live provider generation/playback, real lost-COMMIT acknowledgement injection, native duplicate-PDF upload/new PDF highlights and Mobile uploader/restart remain unverified as described above. This follow-up changes no Web/Extension presentation or contracts. The earlier human UI acceptance remains recorded; no new hands-on UI acceptance is claimed for this backend correction. No deployment or merge was performed.


The final isolated retry exited 0: `HTTP acceptance: passed`, with `independentRecaptureAttribution: true`. The real Edge/Core/R2/KV/PostgreSQL exercise passed all existing format, permission, source-deletion, duplicate, PDF-range and media recovery checks. For HTML, YouTube and podcast destinations it then invoked the actual acquisition publication service against the running local PostgreSQL/R2 resources, retained the destination relation, read the replacement body through HTTP, and observed `has_fork: false`, `fork: null`, and `Cache-Control: private, no-store`. Media manifests became ordinary `capture` snapshots. This is publication/read acceptance, not a claim of full provider/workflow coverage. All resources owned by the harness and the temporary pnpm wrapper were removed.

`pnpm exec openspec validate --all --strict`: 74 passed, 0 failed. `git diff --check` passed. Final local pre-push review selected `add-bookmark-fork`, completed Bugs/Security/Compliance, and confirmed the stale-PDF finding addressed with no remaining Important findings. Historical unrelated acceptance gaps and the previous human acceptance are unchanged.


### Targeted snapshot cleanup — 2026-10-23 (superseded)

Historical evidence only. The later removal decision below supersedes this implementation, migration and eventual-cleanup guarantee.

The project owner approved replacing repeated R2 inventory scans with registered cleanup candidates and authorized implementation after a brief design review. The review tightened pre-write registration, atomic publication/retirement, claim fencing, and the account-deletion path. Scope remains the existing `add-bookmark-fork` change; no public API contract, UI, package version or external service changes.

#### Implementation and rollout

- `sr_snapshot_cleanup` stores one canonical body key per bundle, a publication deadline, next-run time, claim token and creation time. Registration happens before the first PUT; publication removes the record inside the pointer transaction. HTML/media replacement, independent PDF replacement, permanent bookmark deletion and account deletion enqueue retired managed bundles atomically. Mutable legacy keys keep their existing cleanup behavior.
- The existing five-minute cron claims at most 100 due records using an indexed `FOR UPDATE SKIP LOCKED` query. One batch reference lookup uses the new content-pointer indexes. R2 deletion precedes token-checked acknowledgement. Failure leaves the record retryable after its five-minute lease. Publication is limited to five minutes; normal cleanup waits 24 hours. The recurring cleanup path contains no R2 list call. Separate media settlement/index repair remains unchanged.
- Apply the additive migration before updated writers and drain old writers. Pre-ledger orphan files, if any, require a separately authorized one-time inventory/backfill; this change does not silently scan or migrate them. Remote migration/deployment and historical inventory were not performed.

#### Verification

- Schema workflow used only the newly created `slax-snapshot-cleanup-20261023` PostgreSQL 17 container on loopback port 32788: `pnpm api -- gen:diff --name snapshot_cleanup_ledger`, SQL inspection, `pnpm api -- migration:local`, then `pnpm api -- gen:all`. Migration `20261023015312_snapshot_cleanup_ledger` creates the table and three indexes, with no destructive DDL. Public-template local D1 fixture IDs were separate from developer databases. Generated DI was inspected and regenerates the new repository's lazy PostgreSQL dependency correctly.
- Two new bundle regressions failed before pre-write registration/deadline enforcement and passed afterward. Focused bundle/Fork/media/recovery suites passed, including fail-before-PUT and preservation of existing publication guarantees.
- `pnpm api -- test`: **2,418 passed, 100 conditional tests skipped** across 189 passing files. The conditional PostgreSQL tests were run separately.
- `FORK_TEST_DATABASE_URL=<owned loopback database> pnpm api -- test test/infra/snapshotCleanup.integration.test.ts test/infra/bookmarkFork.integration.test.ts`: **29 passed**. Coverage includes concurrent publisher/cleaner row locking, expired/claimed publication rejection, rollback, stale acknowledgements, a 105-record concurrent claim bound, reference checks, PDF replacement, permanent deletion and account deletion while preserving another owner.
- `pnpm api -- typecheck` passed. `pnpm api -- lint` passed with **0 errors / 341 existing warnings**. `SLAX_API_CONFIG=<temporary public-template config> pnpm api -- build` passed as an offline dry-run. `pnpm exec openspec validate --all --strict` passed all **74** items. `git diff --check` passed.
- `FORK_SMOKE=1 pnpm api -- test:http`: final run exited 0 with **HTTP acceptance: passed** and `targetedSnapshotCleanup: true`. Real Edge/Core, PostgreSQL, local R2/KV and D1 exercised all existing format/Fork/recapture checks. The added cleanup exercise removed retired HTML/YouTube/podcast bundles, an interrupted three-file PDF bundle and a permanently deleted PDF Fork. An injected first R2 delete failure retained its record and file; retry deleted both. A live-reference candidate and an active attempt retained their objects. The current article remained readable through HTTP and another PDF copy survived.
- Initial runtime attempts encountered a local HTTP timeout and a Wrangler process that remained open after D1 migrations. The latter held an outbound TLS connection. Following the repository repeat-error rule, investigation compared telemetry suppression, bounded waits/process cleanup, a local update-check cache, and direct service-level validation. Telemetry was already disabled; the efficient fix was a temporary test-only wrapper using the installed pnpm and a fresh Wrangler update-check cache in the harness-owned temporary directory. This follows the cache behavior in [Cloudflare's update-check source](https://github.com/cloudflare/workers-sdk/blob/main/packages/workers-utils/src/update-check.ts); it changes no project dependency, production setting, migration success criterion or application request. The successful run used all real historical migrations and the unchanged HTTP harness. Owned containers, wrapper and temporary configuration were removed afterward.

#### Local pre-push review

Change-id: `add-bookmark-fork`, selected by matching this diff to its proposal and private-snapshot delta among the active changes. Bugs: reviewed every registration/publication/replacement/deletion path, rollback/unknown-commit handling, lease fencing and retry safety; the discovered account-deletion omission was fixed and verified. Security: controlled bundle paths, parameterized SQL, no client-writable cleanup/provenance state, no new secrets/dependencies or remote operations. Compliance: implementation matches the approved targeted-cleanup refinement, generated code and additive migration policy, with the rollout boundary documented. **No remaining Important findings.** This is the author agent's local review, not a claim of a new independent reviewer.

Existing broader verification gaps above remain unchanged, including live provider/workflow and device-only scenarios. There is no new UI-visible behavior, so the previous human hands-on acceptance still applies. Application versions remain unchanged under the user's prior explicit decision. No deployment or merge was performed.


### Removal of automatic snapshot cleanup — 2026-10-23

The project owner explicitly accepted exceptional residual R2 objects and requested removal of automatic cleanup. This supersedes the ledger follow-up above. No cleanup table, new cleanup status fields, JSON task records, R2 scans or replacement service remain. The unmerged `20261023015312_snapshot_cleanup_ledger` migration and its two content-pointer indexes are removed; the Fork provenance migration remains. This task had applied the removed migration only to a disposable container, not a shared or remote database. No DROP migration or remote operation was issued.

Immediate best-effort deletion remains for confirmed failed/losing attempts, superseded managed bundles after confirmed publication, permanent bookmark deletion and account deletion. Unknown publication outcomes retain potentially live files. R2 deletion failure does not roll back successful publication/deletion and no longer creates a retry record. Worker termination and ambiguous failures can leave files indefinitely. The five-minute job is now named snapshot maintenance and retains the bounded 25-row media-settlement/index-repair pass. Existing recycle-bin, deleted-account and canonical media retention jobs keep their purpose.

#### Verification

- A new regression failed before implementation because a retired bundle was left in R2. Focused tests then passed. Additional cases cover deletion failure after successful publication, exact-pointer reconciliation after a simulated lost acknowledgement, uncertain-commit preservation, CAS losers, maintenance cursor advancement/error isolation and account deletion isolation.
- Required schema sequence ran against the newly created `slax-remove-snapshot-cleanup-20261023` PostgreSQL 17 container (loopback port 32792). `pnpm api -- gen:diff --name verify_snapshot_cleanup_removal` generated only `-- This is an empty migration.`; that inspected empty artifact was removed. `pnpm api -- migration:local` and `pnpm api -- gen:all` passed. SQL confirmed the cleanup table is absent and `forked_from_id` is present. Public-template D1 fixture IDs were separate from developer databases. Generated DI/cron registration was reviewed and contains only the maintenance service/job, with the account-deletion bucket dependency wired correctly.
- `pnpm api -- test`: **2,417 passed, 91 conditional tests skipped**, 189 passing files. An initial run before regeneration failed on stale generated imports; after generation, a cron-dispatch assertion still expected the old method name. That assertion was updated and the final full run passed.
- `FORK_TEST_DATABASE_URL=<owned loopback database> pnpm api -- test test/infra/bookmarkFork.integration.test.ts`: **20 passed** against real PostgreSQL, including account deletion with managed HTML/PDF bundles, another owner's preservation and injected R2 deletion failure. Those account-deletion tests use an in-memory R2 fixture; real R2 replacement/permanent deletion is covered below.
- `pnpm api -- typecheck` passed. `pnpm api -- lint` passed with **0 errors / 341 existing warnings**. `SLAX_API_CONFIG=<temporary public-template config> pnpm api -- build` passed as an offline dry-run. Strict OpenSpec validation passed all **74** items. `git diff --check` passed.
- `FORK_SMOKE=1 pnpm api -- test:http` exited 0 with **HTTP acceptance: passed** and `bestEffortSnapshotLifecycle: true`. Real Edge/Core, local R2/KV/D1 and PostgreSQL exercised every existing supported Fork format, duplicates, permission/revocation, source deletion, PDF byte ranges, media variants and recovery. Independent HTML/YouTube/podcast recapture removed each retired bundle while the current body remained readable through HTTP. A real permanent-delete request removed the uploaded-PDF Fork's database row and complete R2 bundle, while a second PDF copy remained intact. The harness removed its owned services and container.
- Local test tooling reused the previously documented installed-pnpm/update-check-cache wrapper. The first schema attempt found an empty removed-migration directory, which was deleted. A create-only migration name prompt was terminated; its owned advisory-lock holder was stopped before the named empty-migration run succeeded. No application timeout, schema safety check or migration result was bypassed.

#### Review and limits

Change-id: `add-bookmark-fork`. A fresh independent reviewer completed Bugs, Security and Compliance passes and rechecked regenerated DI/cron wiring: **no Important findings and no remaining Nits**. The author verified the final evidence trail and updated the proposal, design, tasks, feasibility document and Chinese API flow artifact. The only remaining schema addition in this feature is nullable relational Fork provenance.

Existing broader verification gaps above remain: real lost-COMMIT acknowledgement injection, live provider playback/generation, the complete ordinary capture Workflow, native duplicate-PDF upload/new highlights and Mobile device uploader/restart. Unit tests simulate acknowledgement loss; the local HTTP fixture exercises publication directly where it has no capture Workflow binding. No Web/Extension UI or public contract changed in this follow-up, so the previously recorded human UI acceptance applies. Application versions remain unchanged under the prior explicit decision. No deployment or merge was performed.


### Fixed paths and asynchronous Fork handoff — 2026-10-23

This section supersedes earlier claims about immutable snapshot directories, retired-object deletion, synchronous interactive copying and automatic destination navigation. The branch now uses conventional HTML/text/PDF UUID paths. Interactive Fork and Reader URL saves persist an exclusive destination claim, dispatch the existing Crawl Workflow and return HTTP 200 without waiting for R2. Import/Telegram completion adapters remain synchronous. The action stays on the source and uses account-scoped no-store metadata to disable active/successful copies on visits; explicit Add URL still refreshes a completed copy. No new schema/state/version/cleanup mechanism is introduced by this follow-up. The feature's original nullable relational provenance field remains.

#### Automated and running verification

- `pnpm web -- test`: **2,532 passed, 3 skipped** across 223 passing files and one skipped file. `pnpm web -- typecheck` and `pnpm web -- build` passed. After import sorting and test-variable lint corrections, the focused Fork/Add URL suites passed again: **28 tests**. Initial UI regression tests had failed before removal of navigation and addition of persisted button state.
- `pnpm web -- lint` is **not globally clean**: the unchanged `cead5d4f` checkout reports 108 errors/435 warnings; the final checkout reports 106 errors/435 warnings. No broad unrelated lint cleanup was performed. ESLint on all three changed component/composable/test files reports **0 errors, 2 existing explicit-any warnings**. The new snake-case test-local variable violation was fixed, as were import-sort errors in the touched files.
- Final `pnpm api -- test`: **2,473 passed, 102 conditional tests skipped**. Focused domain/Workflow/controller/Telegram/local-launcher suites: **111 passed**. API typecheck passed; lint reports **0 errors, 345 existing warnings**. Public-template `pnpm api -- gen:all` regenerated DI/types with no net generated-file diff. `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build` passed as an offline dry-run.
- A newly owned disposable PostgreSQL instance applied all **54 migrations** and passed **30 integration tests**. Cases include unique concurrent admission, ordinary-capture exclusion, provenance preservation, source/account/deletion-scoped status, both cancellation checkpoints followed by trash/restore/re-admission, stale cancellation preserving a newer claim, and accepted Workflow dispatch with a lost acknowledgement while an actual service copy is held before PUT completion. The competing admission remains excluded and the final content publishes correctly. Faults in this last case are controlled test boundaries around real PostgreSQL plus an in-memory bucket; it is not a claim of provider-network fault injection.
- Fresh `FORK_SMOKE=1 pnpm api -- test:http` passed against **real isolated Edge/Core Workers, Crawl Workflow, local R2/KV/D1 and disposable PostgreSQL**. It exercised HTML, shortcuts, uploaded PDF, URL PDF, YouTube and podcasts; same-UUID/fixed-key refresh; source deletion independence; access/attribution revocation; PDF ranges; media variants; `/add` and `/add_url` Reader classification; independent recapture and deletion. A missing source body returned **HTTP 200 before copy success**, exhausted background retries to failed, then succeeded under an explicit same-UUID retry after the body became available. Viewer metadata reflected failed/success while anonymous metadata remained null. The fixture cleaned up its own resources; it did not reset or seed the primary user's database.
- Browser-driven testing used real `SnapshotForkButton`/`useBookmarkFork`/Add URL components with explicit simulated account/HTTP/sync boundaries. Verified one request for shared-source controls, disabled submitting state, admission staying on the source with no navigation, disabled non-busy saved state, server failed/success reconciliation on revisits, request-failure unlocking and account isolation. Real component state rendering was checked in **320/768/1280px embedded document viewports**, each under **light/dark/e-ink**, for ready/submitting/saved/failed-retry states. The button retains its 44px minimum hit height. These fixtures are agent evidence, not a substitute for a real user's complete authenticated UI exercise.
- `pnpm exec openspec validate --all --strict` and `git diff --check` pass. The one optional contract field remains backwards-compatible. Existing application versions are preserved under the owner's explicit no-bump decision.

#### Review fixes and explicit limits

Independent Bugs/Security/Compliance review identified three Important issues, all corrected and covered by regressions: cancelled soft-trash attempts left an active status after Workflow exit; podcast feature denial happened after admission; and a lost Workflow dispatch acknowledgement could prematurely release an in-flight fixed-key writer. Cancellation now fails only the matching timestamp; resolved media gates run before admission and again before execution; deterministic Workflow status resolves accepted dispatch, while unknown dispatch retains its claim.

A fresh independent recheck completed Bugs, Security and Compliance passes with **no remaining Important findings**. Two documentation precision Nits (active same-source reuse and new-object cleanup) were corrected before handoff.

Fixed paths cannot provide cross-object or R2/SQL atomic rollback. A failed update may leave partially replaced files. Hard interruption or unresolved dispatch can leave `parseing` requiring manual recovery; ordinary rescue does not steal this state or crawl the external original for a Fork. No automated R2 orphan inventory/reclamation was restored. External provider generation/playback, complete ordinary acquisition Workflow integration, native duplicate PDF upload/new PDF highlights and Mobile device upload/restart retain their earlier declared gaps. Real lost-COMMIT/provider-network failure injection remains unverified.

#### Human acceptance and primary-checkout handoff

**New human hands-on acceptance remains pending.** Earlier acceptance on 2026-10-22 does not cover the changed no-navigation/asynchronous UX. On 2026-10-23 the owner explicitly instructed: finish the changes, commit and push them to the existing PR, leave the primary checkout on this branch, then let the owner run local dev and test manually. This direct instruction supersedes the default pre-push acceptance order for this handoff. No acceptance is inferred or fabricated; R19 stays unchecked.

The primary checkout is `/Users/yjc/Documents/Company/slax-reader-v2` on `feat/add-bookmark-fork`. Its earlier local reset/setup and provenance migration were already completed with owner authorization. This follow-up did not reset or seed it. Agent-owned dev servers are stopped for manual startup via `pnpm api -- dev` and `pnpm web -- dev`. The implementation report and current flowcharts are in `docs/api/bookmark-fork-fixed-paths.md`; a Chinese companion report is delivered outside the repository. No production deployment or merge is performed.


#### Remote review feedback on `5b0f503c`

[Automated review](https://github.com/slax-lab/slax-reader/pull/354#pullrequestreview-5627343500) found no Important Bugs or Security findings. Its Important Compliance finding is the still-pending human acceptance; this remains a merge prerequisite, consistent with the owner's explicit push-first/test-later instruction. The stale earlier sentence saying R15 remained unchecked was corrected; R15 machine work is complete and R19 human acceptance is pending. No human acceptance was fabricated and no merge was attempted.

The review's historical-shared-conversion availability Nit is now explicitly documented: conversion retains the personal relation but reserves a new private content key before copying, so a failed/undispatched copy can temporarily remove access to the previously shared body through that relation until retry succeeds. Other owners' shared content remains intact. The remaining naming/busy-import/missing-object observations are nonblocking Nits, not changes implemented in this handoff. The technical CI checks on `5b0f503c` passed; the review gate remains blocked on acceptance.
