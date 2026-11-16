# Validation

## Scope and approval

- Change: `fix-expired-session-cold-start`.
- Proposal, design, and regression scope approved by the user in this chat on 2026-11-12 ("ok确认").
- Dedicated worktree: `/Users/yjc/.codex/worktrees/fix-expired-session-cold-start/slax-reader-v2`, branch `fix/fix-expired-session-cold-start`, based on fetched `origin/dev`.
- Runtime scope: one locale initialization expression in the Web user store. No changes to cookie cleanup, session lifetime, API contracts, synchronization scheduling, or storage formats.
- No package-version increment: this change affects Web only, following `docs/release/VERSIONING.md`.

## Automated evidence

Checks use the documented non-secret placeholder environment from `docs/web/development.md`: development profile, Web origin `http://localhost:3217`, API origin `http://localhost:8787`, synthetic cookie `slax_test`, and synthetic Google client ID. No production credentials or accounts are used.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | Passed; repository install scripts and selection package build completed. |
| `pnpm web -- setup` | Passed. |
| Baseline: `pnpm web -- test tests/unit/stores/user.spec.ts tests/unit/composables/useAuth.spec.ts tests/unit/local-first/connector.spec.ts` | 89 tests passed before runtime edits. |
| RED: `pnpm web -- test tests/integration/auth/expiredSessionColdStart.spec.ts` before the fix | All five cases failed with real vue-i18n error code 26. The expired/401 paths rejected during real authentication cleanup before first component setup. |
| GREEN: same new integration file after the one-line fix | Five tests passed. |
| Focused final: new integration file plus `profile-ordering`, user store, locale fallback, authentication, connector, and PowerSync bridge-session files | Seven files, 116 tests passed. |
| `pnpm web -- test` after completing the application mock fixture; rerun again after human acceptance | 234 files passed, one file skipped; 2789 tests passed, three skipped; exit 0. The run logged a happy-dom fetch teardown `AbortError` without reporting a failed test or unhandled-error summary. |
| `pnpm web -- typecheck` | Passed. |
| `pnpm web -- build` | Passed, producing the Cloudflare Pages bundle and prerendered entry pages. This used the documented development configuration with production bundling; it does not validate production deployment secrets/configuration. |
| ESLint on all three changed TypeScript files | Zero errors; seven pre-existing `no-explicit-any` warnings in the promotion test fixture. |
| Full Web ESLint (`pnpm web -- lint`, followed by the package's same `eslint .` command after formatting the new file) | Fails on the unchanged repository baseline: 88 import-order errors and 435 warnings. The new file's import-order error was fixed; no unrelated files were reformatted. |
| `pnpm exec openspec validate --all --strict` | 135 items passed, zero failed. |

The integration suite retains the actual Nuxt application composer, component `useI18n()`, Pinia store, authentication cleanup, credential boundary, and default-layout setup. It controls only network/database transport, navigation observation, cookie polling, and unrelated child UI. Each case uses a new Pinia; persisted-state hydration uses the real persistence plugin and localStorage. The expired-token case verifies no sync-token request, and the HTTP 401 case verifies one request. Both verify cookie removal, login navigation, working store methods, and a later layout render using that same store.

Initial parallel check orchestration caused a selection-output unlink race and one ImagePreview transform to observe a temporarily regenerated Nuxt tsconfig. These were verification-process collisions, not product changes; serial reruns completed successfully. A promotion test's incomplete application-composer mock was updated to supply the existing `locale` contract.

## Running-environment evidence

The built application was served at `http://localhost:3217` with a local static preview that resolves prerendered HTML entry paths. Headless Chrome used fresh browser contexts and synthetic credentials. The real PowerSync SDK initialized in SharedWorker mode (`worker-v4.js`), matching the mode in the reported production logs. The API boundary was controlled locally; no real account or production data was accessed.

| Entry | Session case | Observed result |
| --- | --- | --- |
| `/` | Locally expired login token | Login controls visible on first visit, hydration complete, cookie removed, zero sync-token HTTP requests, no page exceptions. |
| `/bookmarks` | Locally expired login token | Same result; no manual refresh. |
| `/` | Unexpired login token rejected by `/v1/sync/token` | One sync-token request received HTTP 401; login controls visible, hydration complete, cookie removed, no page exceptions. |
| `/bookmarks` | Unexpired login token rejected by `/v1/sync/token` | Same result; no manual refresh. |
| `/` | No login cookie | Login controls visible through the existing login redirect, no sync-token request, no page exceptions. |
| `/bookmarks` | No login cookie | Same result, with the existing bookmarks redirect target retained. |

The scripts checked the actual email-login control and `nuxtApp.isHydrating === false`; a URL change alone was not accepted as success. Neither the reported missing-method error nor vue-i18n error 26 appeared. An expired session can still produce the SDK's expected `Not signed in` synchronization log; that does not become a fatal page error.

Initial development-server checks also exposed intermittent empty markup while Nuxt remained hydrating. Additional exploratory preview probes intermittently saw pending hydration, so no blanket claim about all Nuxt startup timings is made. The complete six-case built-entry run above and a subsequent five-case acceptance-portal run both passed. PowerSync SharedWorker can keep a worker request pending, making generic browser `networkidle` unsuitable as the readiness assertion; the successful cold-start checks wait for rendered login controls and hydration completion. No router or synchronization scheduling change was added to this scoped locale fix.

Locale smoke checks on `/guide` confirmed fresh English and Chinese initialization and persisted Chinese-over-English and English-over-Chinese application-composer state, without account-language writes or page exceptions. An existing static `<html lang>` assignment can retain the initial language after persisted display restoration; changing that separate presentation behavior is outside this fix. Full authenticated bookmark, article, annotation, and Extension-bridge smoke flows were not exercised against a real backend because this environment deliberately uses synthetic sessions and a local rejection fixture.

Browser evidence is local, not committed: `/tmp/slax-cold-start-browser-results.json` and screenshots `/tmp/slax-cold-start-{expired,rejected,anonymous}-{root,bookmarks}.png`. The acceptance preview is running at `http://localhost:3217/__cold-start-check`; its buttons seed only synthetic sessions and open the actual built application. Its local API fixture runs on port 8787 and rejects sync credentials. All five portal actions were exercised with visible login controls, completed hydration, and no page exceptions.

### Before/after visual evidence

A temporary development preview at `http://localhost:3218` used the exact pre-fix user-store source from base commit `d93adef2` (also unchanged in fetched `origin/dev`). Opening `/bookmarks` with the synthetic expired login cookie reproduced the actual page text `500: TypeError: userStore.changeLocalLocale is not a function`. The screenshot is `/tmp/slax-cold-start-before.png`. The fixed source was restored byte-for-byte afterward and the temporary baseline server was stopped.

The after screenshot is `/tmp/slax-cold-start-expired-bookmarks.png` from the fixed built preview. Both screenshots show a synthetic expired-session entry to `/bookmarks`, light theme, 1280px viewport. The before preview uses development main-thread synchronization; the after preview uses built SharedWorker synchronization, matching the reported production mode. The screenshots show the observed failure/recovery rather than a redesigned interface. Media is attached to the PR, not committed.

## Review

A separate read-only reviewer completed the Bugs, Security, and Compliance passes for this change and found no evidence-backed Important or Nit findings in the runtime fix or regression tests. The review explicitly distinguished mocked navigation/layout integration tests from actual browser hydration proof. Human hands-on acceptance was subsequently completed before PR creation, as recorded below.

The final local pre-push review rechecked the complete diff against `fix-expired-session-cold-start`: the only runtime change reads the existing Nuxt composer; authentication and storage protections are unchanged; regression tests retain the failing boundary; human acceptance and declared verification limits are recorded. No Important findings remain. This is a Web-only task and does not change generated artifacts or require a package-version decision.

## Human acceptance and delivery

- Accepted by: the requesting user in this chat.
- Date: 2026-11-12 (Asia/Shanghai).
- Environment: the local built preview and synthetic-session acceptance portal at `http://localhost:3217/__cold-start-check`.
- Acceptance: after receiving the running preview and the expired/rejected-session verification instructions, the user explicitly confirmed "ok确认了，没问题" (confirmed, no issues).
- Adjustments requested: none.
- This is implementation hands-on acceptance, distinct from the earlier proposal approval.
- Delivery: one Web-only task branch and PR targeting `dev`, with `OpenSpec: fix-expired-session-cold-start`. Archive evaluation remains deferred until the task PR merges, then follows the human-reviewed docs PR flow.
