# Validation

## Scope and Approval

- Change: `snapshot-save-observability`.
- Task branch: `feat/snapshot-save-observability`, based on `origin/dev` commit `89aee48fc9941bc8e573f287c7eaa8496d8958d0`.
- Worktree: `.local/worktrees/snapshot-save-observability` (repository-relative).
- On 2026-11-12 the change requester reviewed and approved the plan in conversation: first add only observability and accumulate a baseline, then change automatic post-authentication saving in the separate `snapshot-save-auto-resume` change. This change implements only the measurement half.
- This change does not define or implement automatic post-authentication saving; that behavior belongs to the separate `snapshot-save-auto-resume` change. It does not change the visible save or login flow and does not add Mobile `device_id` behavior.
- The implementation adds optional first-party properties to existing events. It adds no event name, `save_kind`, `attempt_id`, or final fork-completion event.
- The change is not UI-visible. `DESIGN.md` hands-on UI acceptance is therefore not applicable; the approval above is a scope approval, not a UI acceptance.
- No package version was changed. `docs/release/VERSIONING.md` states that Web and API changes do not use package-version increments.

## Environment Preparation

No secret files were read or copied. All values below are synthetic placeholders documented in `docs/web/development.md` and `docs/api/DEVELOPMENT-DOCUMENT-EN.md`.

- The fresh worktree lacked `.nuxt/tsconfig.app.json`. The documented Nuxt prepare command generated it with synthetic public configuration:
  - `SLAX_ENV=development`
  - `PUBLIC_BASE_URL=http://localhost:3000`
  - `AUTH_BASE_URL=http://localhost:3000`
  - `SHARE_BASE_URL=http://localhost:3000`
  - `DWEB_API_BASE_URL=http://localhost:8787`
  - `COOKIE_DOMAIN=localhost`
  - `COOKIE_TOKEN_NAME=slax_test`
  - `GOOGLE_OAUTH_CLIENT_ID=test-google-client`
  - `APPLE_OAUTH_CLIENT_ID=` and `TURNSTILE_SITE_KEY=` empty
- API tests initially failed at suite load because the worktree had no generated Prisma clients. `pnpm --filter slax-reader-backend gen:model` was run with the documented generation-only placeholder URLs `HYPERDRIVE_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture` and `LOGS_DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture`. Generated clients live under `node_modules`; no tracked file changed.
- Nuxt emitted existing warnings about the absent Turnstile site key, disabled SSR with OG Image enabled, and a localhost site URL. These are synthetic-environment warnings, not failures.

## Toolchain and CI Environment

All accepted evidence in this record uses the toolchain the repository CI uses, not the machine's default Node:

| Item | Value |
| --- | --- |
| Node | `v22.22.2`, the version pinned in `.github/workflows/frontend-ci.yml` |
| Web environment | `frontend-ci.yml` `web` job: `PUBLIC_BASE_URL=http://localhost:3000`, `AUTH_BASE_URL=http://localhost:3000`, `SHARE_BASE_URL=http://localhost:3000`, `DWEB_API_BASE_URL=http://localhost:8787`, `EXTENSIONS_API_BASE_URL=http://localhost:8787`, `COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=slax_test`, `GOOGLE_OAUTH_CLIENT_ID=ci-placeholder`, `FORCE_COLOR=0`, `NUXT_TELEMETRY_DISABLED=1`, `WRANGLER_SEND_METRICS=false` |
| API environment | `api-ci.yml` `check` job: generation-only `HYPERDRIVE_DATABASE_URL` and `LOGS_DATABASE_URL` placeholders, `WRANGLER_SEND_METRICS=false` |
| Web command | `pnpm web -- test` for the full suite; `pnpm --filter @apps/slax-reader-dweb exec vitest run <files>` for focused suites |
| API command | `pnpm api -- test` for the full suite; `pnpm --filter slax-reader-backend exec vitest run --config vitest.config.ts <files>` for focused suites |

The machine's default Node is `v26.12.1`. Its earlier full Web result appears only as a non-CI footnote under "Full Web Run"; it is not accepted evidence and does not describe the repository's CI health.

## Automated Evidence

### Web tests

Command, run from the repository root under Node `v22.22.2` with the `frontend-ci.yml` Web environment from "Toolchain and CI Environment":

```sh
pnpm --filter @apps/slax-reader-dweb exec vitest run \
  tests/unit/composables/bookmark/useBookmarkFork.spec.ts \
  tests/unit/components/Modal/LoginModal.spec.ts \
  tests/unit/components/Modal/index.spec.ts \
  tests/unit/components/GoogleLoginButton.spec.ts \
  tests/unit/components/AppleLoginButton.spec.ts \
  tests/unit/components/global/LoginView.spec.ts \
  tests/unit/components/Collection/SubscribeCollectionButton.spec.ts \
  tests/unit/composables/useAuth.spec.ts \
  tests/unit/pages/authAttribution.spec.ts \
  tests/unit/pages/auth.spec.ts \
  tests/unit/pages/login.spec.ts \
  tests/unit/plugins/firstPartyAnalytics.spec.ts
```

Result: **12 test files passed, 154 tests passed**, exit 0.

Coverage includes:

- Anonymous and authenticated snapshot activation, with the same `source_bookmark_id` on both.
- Snapshot save control data attributes and the authenticated `add_url` request.
- Snapshot modal `screen_viewed`, Google and Apple `element_clicked`, the snapshot email code flow, and ordinary login without snapshot fields.
- `LoginModalAttribution` passes only collection or snapshot provenance into the modal; standalone provider and email components retain the wider type.
- Google and Apple OAuth state, `/auth` callback parsing, and callback recovery.
- Collection attribution retaining its existing Google-only behavior and not leaking to Apple.
- The global click collector recording two same-source snapshot clicks and no source on an ordinary element.
- Login page, modal bootloader, login view, and subscription-button regressions.

### API tests

Run under Node `v22.22.2` with the `api-ci.yml` generation-only environment from "Toolchain and CI Environment":

```sh
pnpm --filter slax-reader-backend exec vitest run --config vitest.config.ts \
  test/domain/collectionAuthAttribution.test.ts \
  test/domain/firstPartyFacts.test.ts
```

Result: **2 test files passed, 85 tests passed**, exit 0.

Coverage includes:

- Snapshot attribution for Google and Apple, both newly created and returning accounts.
- Invalid, absent, malformed, non-UUID, and forged snapshot metadata preserving successful authentication while omitting the attribution.
- Snapshot attribution through the email code path for newly created and returning accounts, with `method=email`.
- Existing collection and HackerLinks behavior.
- `bookmark_saved` with `source_bookmark_id` for an accepted trusted snapshot fork, while `bookmark_id` remains the destination.
- `bookmark_save_failed` with the source for admission failure and rate-limited `add_url`.
- A rate-limited snapshot `add_url` with no `Content-Length`, and the same flow with a scheme-less target.
- A rate-limited ordinary URL with no snapshot source, and an over-100 KiB body that is not parsed.
- Ordinary content save and lookalike-origin URL without `source_bookmark_id`.
- Existing bookmark, collection, import, sync, rate-limit, and deletion event regressions in `firstPartyFacts.test.ts`.

### Typechecks

| Command | Result |
| --- | --- |
| `pnpm --filter @slax-reader/contracts typecheck` | Passed |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed with the synthetic Web environment above; selection build and Nuxt prepare succeeded |
| `pnpm --filter slax-reader-backend typecheck` | Passed, including the contracts typecheck step |

### Lint

| Command | Result |
| --- | --- |
| `pnpm --filter @apps/slax-reader-dweb exec eslint <changed Web source and test files>` | 0 errors; 6 pre-existing `no-explicit-any` warnings in existing test lines |
| `pnpm --filter slax-reader-backend exec eslint src/domain/events.ts src/domain/user.ts src/handler/http/bookmarkController.ts src/middleware/rateLimit.ts` | 0 errors; 4 pre-existing warnings (`any` and unused parameters in existing code) |

No new lint error was introduced. The warnings are on pre-existing lines, not on the added attribution code.

### Whitespace and OpenSpec

| Command | Result |
| --- | --- |
| `git diff --check` | Passed, no whitespace errors |
| `openspec validate snapshot-save-observability --type change --strict --no-interactive` | `Change 'snapshot-save-observability' is valid` |
| `openspec validate --all --strict --no-interactive` | **142 passed, 0 failed (142 items)**, exit 0 |

Baseline and external distinction:

- Before this change's artifacts existed, `openspec validate --specs --strict` reported **111 passed, 0 failed**.
- At that same baseline, `openspec validate --changes --strict` reported 30 existing changes passing and only the then-empty `snapshot-save-observability` failing for having no delta. It also printed pre-existing informational notices about archive refusal for `pull-collection-preferences` and `recover-podcast-truncation`.
- After this change, the full strict run reports **142 passed, 0 failed**. The 142 items are the 111 main specs plus the 31 active changes; this change's new capability delta is validated as part of its change item.
- The full run printed 202 informational messages, all from pre-existing specs or changes (mostly requirement text longer than 500 characters, plus the pre-existing archive-refusal notices). The `snapshot-save-observability` change and its capability spec produced no informational or failing item.
- No external spec or change failure was observed in this worktree.

## Independent Review Correction

An independent review found one Important issue in the first implementation:

- `apps/api/src/middleware/rateLimit.ts` read the request body only when `Content-Length` was 1–100 KiB. A legitimate small snapshot `add_url` body without that header therefore lost `source_bookmark_id` on a rate-limited failure.
- The rate-limit path also did not apply the same HTTPS normalization as the save handler, so a scheme-less `reader.test/b/<uuid>` target was not recognized.

The correction keeps the existing large-body/streaming protection:

- When `Content-Length` is absent, the rate-limit path reads a clone of the body through a bounded stream reader capped at 100 KiB. A body that exceeds the cap is abandoned without parsing. A known length over the cap is still skipped without reading.
- The target URL is normalized to HTTPS when it has no `http` or `https` scheme before domain and source recognition, matching the save handler.
- The original request body is not consumed by the rate limiter; only the clone is read.

Added regressions:

- Rate-limited trusted snapshot `add_url` with no `Content-Length` carries `source_bookmark_id`, and its domain is `reader.test`.
- Rate-limited trusted snapshot `add_url` with a scheme-less target carries the same source and domain.
- Rate-limited ordinary URL with no `Content-Length` carries no source.
- Rate-limited body over 100 KiB with no `Content-Length` is not parsed and carries no source.

Verification after the correction:

| Check | Result |
| --- | --- |
| `pnpm --filter slax-reader-backend exec vitest run --config vitest.config.ts test/domain/collectionAuthAttribution.test.ts test/domain/firstPartyFacts.test.ts` | 2 files passed; 85 tests passed |
| `pnpm --filter slax-reader-backend typecheck` | Passed |
| `pnpm --filter slax-reader-backend exec eslint src/middleware/rateLimit.ts` | Passed with no findings |
| `git diff --check` | Passed |
| `openspec validate snapshot-save-observability --type change --strict --no-interactive` | `Change 'snapshot-save-observability' is valid` |

## Q7 Contract Corrections

The Q7 review requested three contract corrections plus a provider-click scope clarification; all are implemented without automatic resume. This documentation correction changes no code or test.

- The shared contract now defines `LoginModalAttribution = CollectionAuthAttribution | SnapshotAuthAttribution`. `LoginModal` and `showLoginModal` use this narrower type, so HackerLinks acquisition provenance cannot be typed into the modal's contextual `screen_viewed`. The standalone Google, Apple, and email components intentionally retain `WebAuthAttribution` because the standalone login page still carries HackerLinks.
- `source_bookmark_id` is validated against the shared `SNAPSHOT_BOOKMARK_ID_PATTERN` in both the `/auth` callback schema and the API login schema. The pattern is the same 8-4-4-4-12 hexadecimal UUID shape as `sr_user_bookmark.uuid`. Non-UUID values are omitted without failing authentication. Collection and HackerLinks schemas and behavior are unchanged.
- The existing email code path inside the snapshot modal is explicitly in scope. The Web modal test verifies that `verifyEmailAuth` receives the snapshot attribution. The API test verifies `user_created` and `user_logged_in` with `method=email` for new and returning accounts. The no-code `/auth` redirect to `/login` and the `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery link remain out of scope and do not carry snapshot attribution.
- Provider-click scope is now explicitly the snapshot modal or the `/auth` recovery page for the same attempt. The recovery page passes the preserved attribution to its Google or Apple control, and the shared provider component emits the attributed `element_clicked` before navigation. The existing global signup-screen collector may also observe the recovery click without attribution; that pre-existing overlap is recorded in `design.md` and is not deduplicated here.

Existing coverage composes the recovery-page provider click rather than testing it as one integrated flow:

- `apps/web/tests/unit/pages/authAttribution.spec.ts` "preserves snapshot provenance on Apple recovery" verifies that the recovery Apple control receives the snapshot attribution. Google recovery uses the same `recovery.authAttribution` pass-through but has no dedicated snapshot-recovery assertion.
- `apps/web/tests/unit/components/AppleLoginButton.spec.ts` and `apps/web/tests/unit/components/GoogleLoginButton.spec.ts` verify that an attributed provider click is emitted before the authorization request.
- No single test mounts the `/auth` recovery page and clicks its provider control. That integrated browser/component step remains a declared verification gap; the composed unit coverage and the unchanged implementation are the evidence for this documentation clarification.

Verification after Q7:

| Check | Result |
| --- | --- |
| Focused Web suites | 12 files passed; 154 tests passed |
| Focused API suites | 2 files passed; 85 tests passed |
| `pnpm --filter @slax-reader/contracts typecheck` | Passed |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed |
| `pnpm --filter slax-reader-backend typecheck` | Passed |
| Targeted Web ESLint | 0 errors; 6 pre-existing `no-explicit-any` warnings |
| Targeted API ESLint | 0 errors; 4 pre-existing warnings |
| `git diff --check` | Passed |
| `openspec validate --all --strict --no-interactive` | 142 passed, 0 failed |

The email test layer covers the snapshot attribution request and both account outcomes. The recovery gap is unchanged by design: neither the no-code path nor the existing-login link is extended to carry snapshot attribution.

## Full Web Run

Command, as run from the repository root under Node `v22.22.2` with the `frontend-ci.yml` Web environment:

```sh
pnpm web -- test
```

Result: **241 test files passed, 1 skipped; 2,907 tests passed, 3 skipped**, exit 0.

This is the accepted full Web evidence and is consistent with the focused suites above.

Footnote, non-CI local toolchain: an earlier full Web attempt on the machine's default Node `v26.12.1`, before the toolchain was aligned with CI, reported 22 failed files and 263 failed tests (219 files and 2,642 tests passed), dominated by `localStorage undefined`; `tests/unit/composables/useSidebarCollapsed.spec.ts` also failed 5/5 in a separate worktree without this change. That run used a toolchain the repository does not use in CI. It is recorded only as a local observation: it is not acceptance evidence, and it does not indicate that the repository's full suite is broken.

## Full-Suite and Runtime Boundaries

- Full Web (independently rerun and confirmed, Node `v22.22.2`, `frontend-ci.yml` environment, `pnpm web -- test`): **241 files passed, 1 skipped; 2,907 tests passed, 3 skipped**.
- Full API (independently rerun and confirmed, Node `v22.22.2`, `api-ci.yml` environment, `pnpm api -- test`): **250 files passed, 17 skipped; 3,998 tests passed, 144 skipped**.
- An earlier accidental full API invocation during environment preparation failed at module load because the worktree had no generated Prisma clients (136 files and 43 tests failed). That was an environment-preparation failure and is superseded by the full API result above.
- Real Google OAuth authorization, callback, account creation, return to the source snapshot, and second save activation were exercised as recorded below. Apple OAuth and an existing-account returning-login flow were not exercised.
- A real browser session clicked the snapshot control, opened the attributed sign-in modal, completed Google sign-in, returned to the snapshot, and performed the later authenticated activation. No integrated provider click on the `/auth` recovery page was exercised; that path is composed from the recovery-propagation and provider-component tests described above.
- No deployment to any environment was performed.
- Local `/events` HTTP acceptance was verified, but no event-warehouse write, R2 event record, reporting query, or Q7 C5 production acceptance was verified. The change records emitted properties, not accepted warehouse records.
- Production `FRONT_END_URL` and Web `PUBLIC_BASE_URL` origin consistency was not exercised. The implementation uses the existing trusted-reader-URL helper for fork detection and constructs the save target from the same source UUID.
- The selected source identity on `/add_url` is computed from the request URL before any server-side short-link resolution. The Web control sends a direct trusted `/b/<uuid>` URL, so this target flow is covered; a future client that resolves a short link into a snapshot URL would need a separate decision.
- The existing `/auth` no-code redirect to `/login` and the `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery link retain their current behavior and do not carry snapshot attribution. This is an explicit scope boundary, not a silent omission.
- A recoverable `/auth` recovery screen can be observed by both the existing global signup-screen click collector and the attributed provider component. This overlap already exists for collection attribution and was not changed. No browser measurement of that duplicate was performed.
- The fresh snapshot's final asynchronous copy reached `success` as recorded below. The old fixture's `fork_source_not_ready` result and the smoke harness's later fault-injection recapture failure remain limitations; no final completion event was added.
- Mobile `device_id` work was explicitly excluded. Automatic post-authentication saving is defined by the separate `snapshot-save-auto-resume` change and was not implemented or verified here.

## Final Review Corrections

A final review raised one rate-limit safety issue, one test-isolation issue, and one traceability gap; the test counts in this record were reconciled at the same time.

- **Rate-limit clone safety.** Both `request.clone()` calls in `apps/api/src/middleware/rateLimit.ts` are now inside `try`/`catch`. A throwing clone returns `null`, the rejected save is still rate-limited and still emits `bookmark_save_failed`, and the `waitUntil` promise cannot reject. The bounded 100 KiB read, the oversized-body skip, and normal saves are unchanged. No committed test covers a throwing clone; an ad hoc vitest probe injected a throwing `clone()` for both the Content-Length and absent-Content-Length branches, observed one `bookmark_save_failed` event without `source_bookmark_id`, and was removed after the run.
- **Click collector test isolation.** `apps/web/tests/unit/plugins/firstPartyAnalytics.spec.ts` now asserts exactly three `eventLog` calls: two `snapshot_save_button` clicks with `screen_name=detail` and `source_bookmark_id`, and one ordinary click with no source. The test captures the plugin's document listeners and removes them after each test, so a repeated mount cannot double count. No production code changed for cleanup.
- **Q7 traceability.** `proposal.md` and `design.md` now cite the Q7 decision by repository-relative path in `slax-reader-event-tracking` and record that its own branch and pull request must land before this change merges. No main-branch URL is linked because none exists yet.
- **Number reconciliation.** Focused Web is 12 files and 154 tests; focused API is 2 files and 85 tests; full Web is 241 files passed and 1 skipped with 2,907 tests passed and 3 skipped; full API is 250 files passed and 17 skipped with 3,998 tests passed and 144 skipped. The Node `v26.12.1` full Web result is now only a non-CI footnote.

## Local Browser Exercise

On 2026-11-13, the local API and Web development servers were started under Node `v22.22.2` with the developer-provided local configuration. A real Chrome browser opened a public snapshot from the disposable local database and activated **Save for later**. The existing sign-in modal appeared with Google, Apple, and email entry points.

A separate browser network capture observed direct `POST /events` requests. All four requests returned HTTP 200:

| Event | Verified properties |
| --- | --- |
| `screen_viewed` | `screen_name=detail` |
| `bookmark_opened` | `bookmark_id` was the public source snapshot |
| `element_clicked` | `element_id=snapshot_save_button`, `screen_name=detail`, and `source_bookmark_id` was the same source snapshot |
| `screen_viewed` | `screen_name=signup`, `source_screen=detail`, `presentation=modal`, `trigger_element_id=snapshot_save_button`, and the same `source_bookmark_id` |

This verifies real browser event generation and local API acceptance for the anonymous opening, first save activation, and modal exposure. The authenticated continuation and final-copy results are recorded separately below. No event-warehouse or R2 write is claimed by this local exercise.

## Authenticated Local Exercise and Fork Outcome

After the anonymous checks, the local environment initially used a remote API origin. That configuration mistake was identified from the browser's public runtime configuration and corrected by restarting Web with `DWEB_API_BASE_URL=http://localhost:8787`, without editing the developer's configuration file. A new local account was then created through the real Google flow, login returned HTTP 200, and the authenticated save activation reached `POST /v1/bookmark/add_url`, also returning HTTP 200.

The resulting fork relation was created, but its final status was `failed` with `fork_source_not_ready`. The selected source was a September local fixture whose business status was `success` but whose current content object could not be read. Therefore this specific old-fixture path does not establish final content availability.

A fresh isolated `FORK_SMOKE=1 pnpm api -- test:http` run used disposable PostgreSQL, local R2/KV/D1, actual Edge/Core HTTP, and the real Crawl Workflow. Its initial HTML, shortcut, uploaded-PDF, URL-PDF, YouTube, and podcast fork exercises all passed their success checks. The overall harness later failed at `forkSmoke.ts:585` during a separate fault-injection recapture assertion. The complete smoke run is therefore **not** reported as passing; only the earlier initial fork exercises are used as final-copy evidence here.

This combination establishes the real registration, login, second activation, save admission, and fresh-source copy boundaries, while preserving the old-fixture failure and the unrelated later smoke failure as explicit limitations. No automatic post-authentication save was implemented or observed.

## Fresh Snapshot End-to-End Acceptance

On 2026-11-16, a fresh local source snapshot was created with a persisted HTML body and text object. A real browser rendered its title and body. In an anonymous Chrome session, the tester activated **Save for later**, completed Google authentication, returned to the same snapshot, and activated **Save for later** again. The control reached its **Saved** state.

The authenticated `POST /v1/user/login` and `POST /v1/bookmark/add_url` both returned HTTP 200. Independent PostgreSQL and R2 verification then confirmed:

- the new target relation references the fresh source through `forked_from_id`;
- target status is `success`, the relation is active, and private ownership matches the target account;
- source and target accounts are distinct;
- both source and target body objects exist;
- the target body retains the expected title and acceptance paragraph.

The copied HTML is not byte-identical because the fork pipeline rewrites content; the acceptance criterion is preserved readable content, not byte equality. This completes the local user-task acceptance for anonymous activation, authentication, return, second activation, save admission, and final readable content. It does not add automatic resume and does not establish event-warehouse ingestion or Q7 `live` status.

## Pre-push Review Corrections

The final pre-push review found that the email login branch parsed the full Web attribution union, unintentionally allowing collection and HackerLinks attribution through a path whose approved scope is snapshot-only. The branch now parses only `snapshotAuthAttributionSchema`. Regressions cover new and returning email accounts for both rejected attribution kinds, while the existing email-plus-snapshot, Google, Apple, collection, and HackerLinks tests remain unchanged and pass.

The same review identified stale runtime-boundary statements that predated the real browser acceptance. Those statements now distinguish the completed Google and fresh-snapshot exercise from the remaining Apple, returning-login, recovery-click, hosted-deployment, warehouse-ingestion, and Q7 C5 gaps.

Verification after these corrections, under Node `v22.22.2`:

- Focused API: 2 files passed; 85 tests passed.
- Full API: 250 files passed and 17 skipped; 3,998 tests passed and 144 skipped.
- API typecheck passed. `pnpm api -- gen:all` completed without adding a tracked generated-output diff.
- Targeted API ESLint reported no errors; only the existing `no-explicit-any` warning in `user.ts` and the test-file ignore notice.
- `openspec validate --all --strict --no-interactive`: 142 passed, 0 failed.
- No Web file changed in this correction, so the accepted full Web result above remains applicable at that pre-merge revision.

## Dev Merge and Conflict Resolution

After the first product pull request opened, `origin/dev` advanced to `155f9135` with Passkey, Newsletter, and other changes. The only conflict was the import block in `apps/web/app/composables/useAuth.ts`. The resolution retains the snapshot attribution imports and the new Passkey request import and login method. Dependencies were refreshed with `pnpm install --frozen-lockfile`.

The first API typecheck after the merge failed because the generated Prisma client did not yet contain `sr_user_passkey`. The required `pnpm api -- gen:all` refreshed the client; API typecheck then passed, and generation added no tracked output beyond the merged changes.

The following results under Node `v22.22.2` are the current post-merge evidence and supersede the earlier automated counts above:

| Check | Result |
| --- | --- |
| Focused Web | 12 files passed; 178 tests passed |
| Focused API | 2 files passed; 85 tests passed |
| Full Web | 249 files passed and 1 skipped; 3,037 tests passed and 3 skipped |
| Full API | 269 files passed and 20 skipped; 4,263 tests passed and 158 skipped |
| Web and API typechecks | Passed |
| `openspec validate --all --strict --no-interactive` | 137 passed, 0 failed |
| `git diff --check` and unresolved-conflict check | Passed |

The total changes from the earlier runs come from the newly merged `dev` baseline, including its added tests and archived OpenSpec changes. The real local task acceptance and remaining runtime gaps are unchanged.

## Local Review

A local Bugs, Security, and Compliance pass was performed against the implementation, this change's proposal, design, specs, and validation record.

- **Bugs:** the initial local pass checked the two activation paths, ordinary and lookalike saves, and invalid attribution, but it missed the rate-limit body-read gap. An independent review found that Important issue; its correction and four regressions are recorded above. A later review found that a throwing `request.clone()` could leave the `waitUntil` promise rejected; both clone sites are now inside exception handling and the rejected save still emits `bookmark_save_failed` without a source. Under the CI toolchain the full Web and API suites pass; the Node `v26.12.1` full Web failures are a non-CI local-toolchain footnote, not a finding against this change and not evidence of repository-wide breakage. The recovery-screen duplicate observation is documented as a known pre-existing overlap.
- **Security:** attribution is a closed, non-authoritative set of properties. It does not provide identity, provider method, token, permission, or redirect authority. No secret or PII was added to events. No dependency or network boundary was added.
- **Compliance:** the implementation matches the stated observability-only scope. It contains no automatic save, no new event name, no `save_kind`/`attempt_id`, and no final completion event. The no-code and existing-login recovery boundaries remain as approved.

No Important finding remains after the corrections. The requester's approval, the independent review findings, their fixes, and the declared gaps above are the acceptance record for this measurement-only change.
