# Validation

## Scope and authorization

Implementation base: `dev` at `1e821fc5`, isolated branch `feat/add-email-link-auth`. The change requester approved the proposal and direct implementation on 2026-11-18, and approved Mobile 1.0.33 (808), previous build 807. Native metadata was regenerated through Expo; unrelated local Firebase configuration output was restored to the baseline.

No database migration, PowerSync change, new HTTP authentication endpoint, Redis command/Lua, provider replacement, or signing-certificate trust change is included. Existing account ownership policy and session completion are reused. Only Mobile needs a package version change; CLI/Extension do not consume the new proof or link entry.

## Automated evidence

Logs are task-local under `/tmp/slax-email-link-20261118/`.

| Check | Result / evidence |
| --- | --- |
| API typecheck / shared contracts | Passed, `api-type.log`; local dependencies were synchronized with the unchanged frozen lockfile. |
| API full Vitest suite | 4,330 passed, 145 skipped across existing opt-in suites; `api-full.log`. All 18 email Redis tests ran with a disposable real Redis instance. |
| API layers and ownership orchestration | Layer architecture 35 passed; existing provider-link tests and added email-link orchestration passed. No baseline exceptions added. |
| Backend generation | `gen:all` completed using the checked-in example config and synthetic local database URLs, without reading operator credentials; generated source has no tracked drift. |
| Web full Vitest suite | 3,121 passed, 3 skipped; `web-full-final.log`. Initial missing-public-config failures were resolved by supplying non-secret fixture settings; a teardown AbortError was printed by the test DOM, without a failed test. |
| Web typecheck | Passed with non-secret public fixture settings, `web-type-configured.log`. The first unconfigured run's errors disappeared without changes to the unrelated Extension bridge page. |
| Web scoped lint | Passed for the new page, composable, URL capture, routing and startup policy. Existing unused attribution import in `useAuth.ts` remains an existing warning. |
| Mobile full check | 1,307 passed, no skips, `mobile-check-reviewed.log`; later review fixes were verified by the focused controller/mounted suites. |
| Mobile final focused checks | 66 passed: 13 controller cases including real-session hydration, 49 mounted login cases including old Google/Apple/OTP/Passkey and commit preservation, and 4 native configuration cases. See `mobile-real-session.log`, `mobile-focused-final.log`. |
| Mobile typecheck / JS export | Passed; iOS and Android Hermes bundles exported, `mobile-type-final.log`, `mobile-bundle-reviewed.log`. |
| Native configuration | Expo prebuild regenerated version 808, iOS associated domains, and exact-path Android filters. Configuration tests preserve credential associations, fixtures and certificate fingerprints. |
| OpenSpec | Latest acceptance-evidence check: all 153 items passed strict validation, `acceptance-openspec.log`. |

## Running environment

`DOCKER_HOST` selected the local OrbStack socket. `pnpm api -- test:http` exercised the real Core Worker, generated DI/router, PostgreSQL, Upstash client against disposable Redis, and normal account/session logic. New checks passed for a fragment-only login URL, unchanged delivery response, `/login` with `email_link`, verified `mail` binding, and code/link mutual invalidation in both directions. Existing email, Passkey and broader HTTP smoke flows passed. Resend was replaced only at the test transport boundary; no real email was sent. Evidence: `http-smoke.log` and its recorded isolated workspace.

The Web preview at `http://localhost:4296` mounts the actual landing page, composable, request client and cookie completion with the real email domain service/Redis. Resend delivery is captured locally; account/session data is synthetic. Browser testing completed successful login, current-session preservation, consumed-proof recovery, URL scrubbing before the following DOM telemetry trap, and light/dark/e-ink display at default, 768px and 320px widths. No horizontal overflow was observed at the checked widths. Screenshots are retained outside Git: `web-existing-account.jpg`, `web-dark-768.jpg`, `web-eink-320.jpg`.

The actual preview-profile Cloudflare Pages build completed. Local Wrangler Pages serving its build returned 200 for both `/email-login` and `/email-login-web`, with no redirect. AASA and Digital Asset Links returned anonymous 200 JSON under simulated preview, beta and production Host headers. Both existing credential associations and new path-scoped App Links remain present. `autoSubfolderIndex: false` produces flat HTML, so the checked canonical route remains slashless. Preview, beta and production profile builds all completed (`web-build.log`, `web-build-beta.log`, `web-build-production.log`). The production HTML places proof capture before the module entry. Android unsigned Release assembly passed (`android-build-final.log`, 1,524 Gradle tasks). This is compilation evidence, not signing or device acceptance. The first attempt lacked `ANDROID_HOME`; using the existing SDK resolved it without a source change.

## Human acceptance

On 2026-11-18, the change requester exercised the local Web preview's three mail scenarios and explicitly replied “Web 验收通过”. The implemented page displays persistent localized guidance, preserves an existing account, and offers normal sign-in recovery. The earlier optional demo was declined in favor of the reviewed proposal.

The requester also exercised the signed iPhone 12 build with real delivered email links and confirmed successful warm entry, protection of the currently signed-in account, and cold startup returning to the same account. Details and the mail-client boundary are recorded below. Android human acceptance has not occurred; the requester explicitly chose to wait for a Play Beta package for complete Android verification.

## Review closure

See [review.md](review.md). Requested Codex architecture/scope review and actual Claude Opus 5.5 edge review completed. Confirmed findings were reproduced and fixed; evidence-based false positives were withdrawn. No Important finding remains from those reviews.

## Remaining acceptance

- Android signed cold/warm App Link routing and hands-on acceptance are deferred until a Play Beta package, as explicitly requested on 2026-11-18. The connected phone's installed application is 1.0.31 (806); it was not replaced or cleared. The local debug signer differs from the Play certificate trusted by the published association. No certificate trust or device verification state was changed, and no explicit-intent test is claimed as automatic App Link evidence.
- Actual Resend delivery, QQ Web fragment preservation, and signed iPhone system-camera handoff have passed. Direct interaction with native mobile mail applications and the operator's global click-tracking setting remain unverified. Browser-only fallback was exercised locally, not by failure to launch an uninstalled App on a physical device.
- Tasks 4.3, 5.1 and 5.2 remain partially complete; Android deferral is not recorded as acceptance. On 2026-11-18 the requester explicitly confirmed opening the feature Draft PR first and completing Android acceptance in Play Beta. This authorizes the task-specific acceptance order; it does not mark Android as accepted or alter repository policy. No feature code has been deployed or archived by the agent. Support PR #660 and the prerequisite code-only PR #661 were separately merged by the requester.

## Internal-delivery follow-up and publication preflight (2026-11-18)

The requester split code-only internal delivery into Draft PR #661, then requested link logging in this feature. The feature incorporates that prerequisite locally and appends the link to its existing internal-only email/code log. Ordinary addresses and binding requests retain their delivery policy; clients do not log incoming proofs.

Fresh follow-up evidence (`/tmp/slax-email-link-20261118/internal-link-*` and `http-internal-link.log`): 80 focused API tests passed (including 18 real-Redis tests), API typecheck and scoped lint passed, and backend generation completed with no final generated drift. Three new link-log assertions failed before the added link and passed afterward. Full Core Worker HTTP smoke passed again: codes and links read from actual internal issuance logs authenticated through existing login, no provider delivery occurred for internal addresses, and replay / consumed-code attempts were rejected. Existing ordinary-mail OTP/link mutual consumption, binding and Passkey smoke assertions also passed. The fixture message-inspection GET now supplies its existing authentication header.

Support PR #660 merged; live anonymous HTTPS GETs of both `r.slax.dev/.well-known` association files returned 200 JSON matching the expected source, including App Link permission and preserved Passkey entries. This resolves the website-association publication dependency only. iPhone 12 is detected, but native preparation reports Developer Mode disabled; the requester was asked to enable it manually. No App installation or native acceptance is claimed yet. The requester provided a real-mail recipient and a logged-in QQ Mail browser; receipt of a combined real Resend email remains pending local backend configuration. No personal recipient or proof is recorded in this document.

The signed iOS Debug build completed (`ios-device-build.log`), version 1.0.33 (808). `codesign --verify --deep --strict` passed, and the signed application identifier is `8G3A932HJG.app.slax.reader` with both credential and App Link associations for all three public hosts (`ios-signed-associations.json`). This is a build/signature check only; it has not been installed or accepted on iPhone 12. It was prepared without loading operator Mobile dotenv configuration.

## Live delivery and iPhone installation preflight

The requester supplied a temporary test-only Resend key and a designated mailbox. The key was entered with terminal echo disabled, held only in the local relay process, and removed from its environment before child processes started; it was not written into configuration, source or logs. The temporary ignored relay uses disposable Core/PostgreSQL/Redis, takes the actual Core-generated code/link, and forwards the combined message through the existing formatter and Resend adapter. Only the designated real recipient or reserved internal test addresses can request delivery through this relay. This is a test transport boundary, not a deployed Worker holding the live key.

Resend returned HTTP 200. The designated QQ Mail Inbox displayed the combined email from `noreply@reader.slax.dev`; its clickable URL retained the expected HTTPS origin/path, empty query and complete `email`, `request_id`, `token` fragment. This verifies one delivered message and its QQ Web link representation, not all mail clients or the operator's global tracking setting. No personal recipient or active proof is retained in durable project evidence.

Apple's association CDN also returned the expected `applinks` entry for preview. After the requester enabled Developer Mode, the iPhone 12-specific signed build succeeded and version 1.0.33 (808) was installed and launched. The device had no installed Slax Reader app before installation. The local Metro and isolated API relay are running; actual on-device login and human acceptance remain pending. Device Hub reports that remote screen viewing needs iOS 27+, while this device runs iOS 26.6.1, so the requester must observe the screen directly. This does not change the application's supported OS floor.

On 2026-11-18 the requester confirmed that the iPhone 12 reached the login page. Its first send attempt exposed a temporary relay issue: native `Accept-Encoding` was forwarded upstream, but the relay's raw Node HTTP response was parsed without decompression. Direct probes showed plain JSON for `identity` and gzip bytes for the native header. The ignored local relay now requests `identity` upstream; the same compressed-client-header, unauthenticated-binding probe returns the expected readable HTTP/application 401 instead of the relay's 500. No product source changed for this fix. The requester was asked to retry sending before link acceptance proceeds.

## iPhone 12 live-mail handoff verification

On 2026-11-18 the requester successfully requested a combined email from the iPhone 12's actual login UI after the temporary relay correction. The delivered QQ Web mail retained its complete link. A locally generated QR encoded that exact clickable URL for system-camera handoff; this is a verification tool, not a product QR feature. The requester explicitly confirmed that the link opened Slax Reader and signed in successfully. A subsequent submission of the sibling email code to the same real Core API returned `EMAIL_VERIFY_CODE_ERROR`.

The requester then scanned the same link while signed in and explicitly confirmed the sign-out guidance and preservation of the current account. For cold launch, the requester signed out and requested a fresh real email; the agent terminated only Slax Reader PID 640 on the test iPhone and confirmed it was absent before the second QR was scanned. The requester explicitly confirmed cold startup, successful login and return to the same account. Receipts include `iphone12-cold-stop.log` and `iphone12-after-stop.json`; active proofs and personal mailbox details are excluded from this document. The result covers signed iOS system URL handoff from the real delivered link. Direct interaction with a native mobile mail app remains unverified; QQ Web representation and system-camera handoff are the exercised boundaries. Android remains deferred to Play Beta by the requester; overall feature-PR acceptance remains open.

After that decision, the task-owned live relay and Metro were stopped and ports 8789 and 8081 had no listener. The test-only Resend key is no longer held by the relay process. Diagnostic records and signed build outputs remain local for the pending handoff; no mailbox screenshots or link QR images are committed or attached publicly.

## Pre-push acceptance-order confirmation

On 2026-11-18 the requester explicitly confirmed creating the feature Draft PR first and completing Android acceptance through Play Beta. That confirmation is recorded in `proposal.md`; tasks 4.3, 5.1 and 5.2 remain open for their stated unverified boundaries.

Fresh pre-push checks on the final implementation passed: 80 focused API tests including all 18 real-Redis cases and 35 architecture checks (`pre-push-api.log`), 97 Web page/auth/startup/login regression tests (`pre-push-web.log`), 66 Mobile controller/mounted/native-config tests (`pre-push-mobile.log`), all 153 strict OpenSpec items (`pre-push-openspec.log`), and `git diff --check`. These reruns supplement the earlier full suites, builds, live service evidence and independent reviews. Only acceptance documentation changed after the exercised implementation.
