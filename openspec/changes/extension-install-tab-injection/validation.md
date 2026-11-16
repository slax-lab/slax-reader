# Validation

Date: 2026-11-16
Change: `extension-install-tab-injection`
Branch: `feat/extension-install-tab-injection`
Status: implementation, automated checks, and real first-install/no-refresh collection verification completed. On 2026-11-16, the requester confirmed prior hands-on acceptance, approved Extension version 1.16.4, and authorized the task PR. The supplemental PDF regression remains incomplete as detailed below. Store publication, merge, and archive are not authorized.

## Implemented scope

- First-install-only activation starts after content readiness reset and independently of login and other installation work.
- The background queries HTTP(S) tabs, probes the top-frame collector, reuses explicit readiness acknowledgements, and otherwise inserts page highlight CSS followed by optional vendor and collector scripts from known manifest entries. WXT retains Shadow DOM UI styling.
- Per-tab failures are isolated. New failure logs contain neither page URLs nor raw errors. No automatic save, tab reload, navigation, new retry scheduler, or PDF behavior change was introduced.
- HTTP(S) host permissions were added; unrelated API permission names and file access declarations remain unchanged.
- The development guide now documents first-install/no-refresh verification.

## Automated checks

All standard commands used the documented non-secret build-only environment: `SLAX_ENV=development`, `PUBLIC_BASE_URL=http://localhost:3000`, `AUTH_BASE_URL=http://localhost:3000`, `SHARE_BASE_URL=http://localhost:3000`, `EXTENSIONS_API_BASE_URL=http://localhost:8787`, `COOKIE_DOMAIN=localhost`, and `COOKIE_TOKEN_NAME=slax_test`. These values do not establish a running real service or an authenticated account. No secret files were read.

- Focused install, readiness, and locale-entry regression: 4 files, 25 tests passed.
- `pnpm extension -- typecheck`: passed.
- `pnpm extension -- test`: 27 files, 127 tests passed.
- `pnpm extension -- build`: passed.
- `pnpm extension -- zip`: passed; regular unpacked artifact under `apps/extension/build/chrome-mv3`, zip under the normal ignored build directory. After the approved version bump, build and zip verification passed again for 1.16.4; package metadata and the unpacked manifest both report 1.16.4. These final artifacts use the authorized test-service configuration, not a production release configuration.
- ESLint passed for the changed background source and both new tests. Running ESLint on `wxt.config.ts` reported its pre-existing `simple-import-sort/imports` error. The exact same error was reproduced by piping `git show HEAD:apps/extension/wxt.config.ts` into ESLint with the same filename. Unrelated import formatting was left unchanged.
- `pnpm exec openspec validate --all --strict`: 136 passed, 0 failed.
- `git diff --check`: passed.

Initial failed attempts were corrected: the lifecycle test fixture lacked the existing startup `tabs.query` mock, and manifest-derived script paths needed the installed WXT `ScriptPublicPath` type. Newly introduced import-order errors were corrected and the full final verification chain was rerun successfully. The first test preparation also showed missing real integration configuration; subsequent build-only checks used the documented placeholders above.

## Artifact inspection

The generated manifest was parsed and each declared content-script/CSS file was checked for existence. It includes `http://*/*`, `https://*/*`, and preserved `file:///*` host access. The collector entry points to `content-scripts/content.js`; page-level CSS points to `content-scripts/mark.css`. `content-scripts/content.css` remains a WXT web-accessible UI resource rather than a global manifest CSS entry.

The standard artifact tested here has no externalized vendor entry. Vendor-present ordering is covered by unit tests; no vendor-present browser run is claimed.

## Running-browser verification: real first-install and collection passed

The Desktop browser tool was not exposed with a callable definition. On 2026-11-16, the change requester explicitly approved a separate temporary Chrome profile, required deletion after testing, and supplied an API endpoint and test credential. The credential was held in the test process and temporary browser session only, never in source files, build parameters, screenshots, or this record. It was sent only to the authorized service by the tested extension and scoped API verification. The CU runtime could not resolve the API hostname or resolve the project's Playwright link, while the project host could; the existing local Playwright dependency was used without changing network security settings or accessing personal Chrome data.

The regular unpacked extension was rebuilt with `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, and `SHARE_BASE_URL` set to `https://r.slax.dev`, `EXTENSIONS_API_BASE_URL=https://reader-api.slax.dev`, `COOKIE_DOMAIN=r.slax.dev`, and a dedicated test cookie name. API routes already include `/v1`, so the configured API base is the origin. No credential was embedded in the bundle. Browser: Google Chrome 158.0.8127.36, headed, 1280 by 900 viewport, disposable profile.

Observed sequence and results:

1. An authenticated read-only `/v1/user/me` request returned HTTP 200 and business code 200. No account response contents were printed or retained.
2. Before installation, opened the public MDN JavaScript Guide Introduction page with `?slax-install-test=20261116` and a second public `example.com` tab. Neither page had a collector host. A `chrome://extensions` page was also open.
3. Loaded the normal unpacked extension through Chrome's actual `Extensions.loadUnpacked` operation. The worker reported `Extension installed, reason: install, browser: chrome`. No install event was simulated.
4. Before any collection action, both original web tabs returned `{ready: true, kind: 'html'}` to the top-frame probe. The source had exactly one collection host and one sidebar. The popup had a white computed background, fixed positioning, and 300px width; installation sent zero bookmark-add requests.
5. Source marker, title, URL, and `performance.timeOrigin` matched their pre-install values; the second tab's time origin also remained unchanged. The browser-internal tab did not prevent activation.
6. Triggered the real Chrome toolbar action once. Exactly one `/v1/bookmark/add` request returned HTTP 200/business code 200 with bookmark ID `297516816494`. The original page visibly displayed `Collected` with its MDN title; the screenshot was inspected.
7. A scoped read-only `/v1/bookmark/brief` request confirmed the saved bookmark's source matches the original article and returned bookmark UID `d6e1d900-d38f-42dc-a20e-27f1566f084e`. The original document marker and time origin were still unchanged. The test bookmark remains in the authorized account; no existing bookmark was deleted.
8. A page opened after installation received the normal collector. Removing only the dedicated test-session cookie and invoking the toolbar on the second page opened the existing login route without another bookmark-add request.
9. The test closed its browser context and deleted its profile in `finally`. A separate filesystem/process check confirmed the exact profile directory no longer existed and zero processes referenced it.

The core requested scenario is therefore verified against the real backend, not a mocked API. PDF/file-access browser regression is tracked separately below. Human hands-on acceptance is not inferred from this agent-driven test: the requester separately confirmed on 2026-11-16 that they had already completed acceptance. This change does not alter UI presentation.

## Supplemental PDF regression

The headed existing regression command `HEADLESS=0 node apps/extension/tests/pdf-browser.mjs` built its fixture and passed the local PDF toolbar-save scenario and the automatic online suffix/extensionless PDF scenarios. It then timed out after 30 seconds waiting for `Checking your account|正在检查账号` at `apps/extension/tests/pdf-browser.mjs:71:67`, called from line 104. Later repeated-action and file-permission scenarios were not reached. The cause has not been established; this is not evidence that the new installation activation caused a PDF regression. No unrelated PDF behavior was changed.

Task 3.4 remains incomplete: the full supplementary browser regression is not green, despite the successful core first-install/no-refresh collection acceptance and passing automated PDF tests. The fixture browser context closed and its temporary profile was removed.

## Local review

- **Bugs:** no Important source findings in the scoped diff. Checked install reason gating, readiness reset ordering, explicit acknowledgement handling, CSS/script ordering, top-frame targeting, query rejection handling, and per-tab isolation. Existing click recovery and PDF paths are unchanged.
- **Security:** no Important source findings. Broader HTTP(S) host access is an explicit approved proposal implication, not a claim of unchanged privilege. Existing cookie-change processing still checks configured domain and name; session deletion filters domains before removal. `cookies.getAll({ name })` can now enumerate matching-name cookies over the broadened granted origins before that filter, as expected from the broader permission; no new transmission or logging is introduced. The web-request listener remains limited to the configured bridge URL.
- **Compliance:** implementation matches the linked capability and first-install-only scope. Automated checks and the real first-install/no-refresh collection scenario passed. The supplemental PDF browser regression remains incomplete as recorded above; no all-green compatibility claim is made. The requester explicitly confirmed prior hands-on acceptance and approved version 1.16.4 and the task PR. No UI presentation changes were made. Merge and archive remain outside this delivery.

## Acceptance and delivery

- Isolated Chrome verification and the real-service test session were explicitly authorized and completed. Both temporary browser profiles were removed; no personal browser profile was used.
- Task 3.4 remains incomplete because the supplementary PDF browser suite timed out before its later repeated-action and file-permission scenarios. Its cause is not established.
- The requester approved Extension version 1.16.4 on 2026-11-16. The package version was updated; the final build and zip succeeded, and package/manifest versions match.
- On 2026-11-16, the requester explicitly confirmed that prior hands-on acceptance was complete and requested the PR. No additional acceptance gate is pending; this change does not alter UI presentation.
- The successful real-service test created one public MDN bookmark in the authorized account. It was not deleted without authorization.

## Workspace hygiene

Final status contained only the intended source/configuration/documentation changes, two new test files, and this change's planning/evidence artifacts. Task-created acceptance scripts, screenshots, result files, and supplemental PDF build outputs were removed after verification. Both temporary browser profiles were deleted, and no task-owned Chrome profile processes remain. Standard ignored WXT, selection build, regular unpacked build, and zip outputs were retained. The final 1.16.4 unpacked artifact and zip use the authorized test-service configuration and a dedicated test cookie name. Neither is presented as a production release artifact. The requester authorized commit, push, and the task PR; publication, merge, and archive are outside this delivery.
