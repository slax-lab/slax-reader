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

The application source is unchanged from the final passing test/build and browser/Extension runs. This handoff revision updates acceptance and PR documentation only; the strict OpenSpec and whitespace checks are rerun before commit.
