# Web Email Login Refinement Verification

## Scope and authorization

- Change: `refine-email-login-flow`; branch: `fix/refine-email-login-flow`, created from `origin/dev` at `89aee48f` after PR #584 merged.
- On 2026-11-12, the change requester reviewed the written five-part proposal, confirmed Web-only beta rollout with App unchanged, declined a separate mockup, and explicitly authorized implementation. They requested a local preview for hands-on review before further delivery.
- Implementation affects four Web Vue components, one small browser-preference utility, and three existing test suites. It changes source order, email-entry hierarchy, one-address local preference, successful-login pending state, and two Web rollout predicates. In that completed Web phase, no App, Extension-native UI, backend, contracts, package output outside Web, dependency, or environment-file changes were made. The approved native presentation extension is tracked separately below. Existing icon assets/registry entries are reused.
- The three predecessor capability deltas retain their single original owners. Their proposal/design annotations distinguish historical merged completion from this follow-up's proposed/implemented requirements. The new continuation delta covers remembered address and departure behavior only. Coordinated archive waits until the follow-up task PR merges.

## Completed Web Phase: Automated verification

- Regression-first run of the three affected component suites: **18 failed, 32 passed** before product code changed. Expected failures covered provider-first ordering, beta availability, successful-email prefill/replacement, and the post-verification navigation gap. The source investigation also confirmed that the installed Nuxt external-navigation helper returns after assigning `location.href`, while the old form unconditionally cleared its pending state.
- After implementation, the account section, account page, standalone login, modal login, and authentication suites passed **100 tests in five files**. A final run repeated those 100 tests after strengthening the success-lock assertion to exercise the module's exposed Cancel operation.
- Full Web suite: `/tmp/slax-signin-run.sh pnpm web -- test --maxWorkers=3` passed **240 files, 2,902 tests**, with one file and three tests skipped. The successful run emitted an `api.test` DNS diagnostic from fixture-related background traffic; it did not fail a test.
- Web type checking exited 0. Targeted ESLint covers all four changed Vue files, the new utility, and all three changed test suites. Strict OpenSpec validation passed all 142 items; whitespace checks passed. The final targeted lint and post-document strict validation also exited 0; whitespace checks remained clean.
- Tests cover development/preview/beta complete login and binding flows, production omission including bound accounts, explicit navigation failure, invalid-code retry, cancelled late results, invalid or inaccessible preference storage, stored-address editing/replacement, no writes on Send/failure/cancellation, account binding isolation, and success focus/announcement behavior.
- No Web production build or hosted deployment was performed. This Web-phase evidence did not trigger a package-version decision; the new App extension requires a Mobile version decision after validation.

## Running application

The actual Nuxt app ran at `http://localhost:3287` with `SLAX_ENV=beta`, using explicit synthetic public configuration and the separate loopback API fixture on port 8894. No secret files were read. Real production components, routing, CSS, icons, session-cookie handling, and request paths were exercised; the fixture captured mail requests and never delivered real email or completed OAuth. Fixture code is `012345`.

### Login presentation and existing flows

- Chromium verified both standalone and modal hosts in English/Chinese at 1280/768/540/390/375/360/320px in light/dark/e-ink, at both address/code stages: **168 layout cases**. Inputs/actions remained side by side, controls retained at least 44px height, input space remained usable, and no horizontal overflow or uncaught page errors occurred.
- Both hosts present Google, Apple, then email in source order. The collapsed email entry uses a transparent border/background and muted semantic text, retaining its identifying envelope, 44px target, hover/focus feedback, and explicit label. Expanded Send/Verify keeps its previous stage emphasis. Images were visually inspected at desktop and 320px, including the Chinese modal.
- All four host/locale flows exercised keyboard Send/Verify, busy states, wrong-code feedback, change-address/cancellation focus, successful session-cookie persistence, and the original destination including query/hash. Standalone referral and locale/purpose request values remained intact. The real 320x568 modal retained scroll access to supporting actions/legal content and restored scrolling on dismissal.
- A fresh beta account smoke confirmed an empty binding field even with a stored anonymous login address. Successful binding kept the existing account/provider, closed the form, announced success, restored row focus, and left the remembered login address unchanged.

### Account layouts and production exclusion

- The account subsection passed 84 address/code measurements across the same seven widths, three themes, and two locales, including keyboard Send/Verify, invalid-code feedback, change-address, successful binding, and final row focus. The email group is last after Google/Apple; captured account cards were visually inspected.
- A separate actual production Nuxt process checked bound/unbound accounts at 1280px/light, 768px/dark, and 320px/e-ink (six cases), plus anonymous login. The entire account subsection and email login were absent; Google/Apple remained available. The beta process was restored afterward for local acceptance.

### Successful verification and remembered address

- The browser test deliberately aborted the destination document request after authentication so the old login page remained available for inspection. Both hosts retained disabled Verify, code input, change-address/resend, and local Cancel, with `aria-busy=true`, even after navigation initiation returned. Direct form submission and clicking the disabled submit control produced **zero additional verification requests**.
- Each host first rejected a wrong code and permitted correction. Send and failed verification retained the previous remembered address; successful session completion replaced it before departure. After proceeding to the original bookmark destination and clearing only the fixture session cookie, a later anonymous form prefilled the new address.
- Initially, holding a pending navigation while inspecting it via Playwright locators/evaluation stalled the harness on the browser's navigation handling. A bounded CDP attempt confirmed the same tooling limitation. The final test aborts the document navigation to keep the old surface inspectable, verifies its state directly, then explicitly proceeds to the same destination. These harness attempts did not change product code. A continuously pending document request was not directly inspected; the successful non-departed state is covered by the browser test and the resolved-navigation mounted regression.

## Completed Web phase: review and acceptance

For the completed Web phase, an independent read-only reviewer performed all `REVIEW.md` Bugs/Security/Compliance passes on the actual diff and approved planning artifacts. No Important or Nit findings were found. The review checked the terminal pending/departing guards, cancellation and late-result checks, binding isolation, navigation errors, preference persistence boundaries, provider order, Web-only beta scope, and unchanged native App policy.

On 2026-11-12 the change requester exercised the prepared beta-profile Web preview and stated they were satisfied. This records fresh hands-on acceptance of the Web ordering, quiet email entry, remembered address, successful-verification lock, and Web beta rollout. Prior PR #584 acceptance remains historical. The requester then asked to extend provider-first presentation to App; that additional native presentation scope requires its own planning and acceptance. At that checkpoint App refinement and combined delivery were outstanding; their later evidence is recorded below. Real email delivery, hosted beta credentials, actual Google/Apple authorization, native Safari, and live PowerSync were outside that Web fixture exercise; subsequent native App execution is recorded below.

## Local evidence locations

Harnesses, captured screenshots, and browser measurements are outside Git at `/tmp/slax-email-followup-evidence/`. Test/type/lint/OpenSpec logs are `/tmp/slax-email-followup-*.log`. Only this self-contained text evidence is tracked.


## Approved Native Presentation Extension (2026-11-12)

After accepting Web, the change requester reviewed the explicit App scope and authorized implementation: preserve Google/iOS-Apple/email login order; make the email entry borderless and subordinate; move the complete account mailbox group below provider states/actions; and quiet the email-binding action while retaining Mobile tokens, touch targets, pressed/disabled feedback, agreement and verification contracts. App environment policy, native address persistence, authentication, and provider configuration remain unchanged.

- Changed `LoginScreen.tsx`, `AccountSignInMethods.tsx`, and four ordering regressions in the existing settings suite. The initial focused test invocation lacked the worktree's Mobile dependency closure; installing it with the frozen lockfile resolved setup without changing the lockfile. The regression-first run then failed the four new Android/iOS ordering cases before product changes.
- After implementation, the existing login/settings mounted suites passed all 61 tests with no skips. They retain agreement, cancellation, session commit, platform-specific provider, development-only visibility, bound identity, and mailbox ownership coverage.
- `pnpm mobile -- bundle` exported both Android and iOS bundles successfully. The initial `pnpm mobile -- check` passed architecture/assets/fixture verification and type checking, then reported 1,231 passing, seven failing, and four skipped tests. All seven failures were missing `kotlinc` executable prerequisites, not assertions about the new UI. A standalone official Kotlin 2.4.21 compiler was installed only under `/tmp/slax-email-followup-toolchain` using the vendor's documented manual distribution. Repeating the complete check with that temporary compiler on PATH passed all 1,239 tests, with three skips and zero failures, in 182.4 seconds; architecture/assets/fixture checks and type checking also passed.
- The iOS native fixture already renders the current production components using the previously installed isolated `app.slax.reader.uifixture.emailotp` development client. The temporary test host disables real providers/telemetry, uses memory-only synthetic accounts/responses, and includes immutable copies of the two pre-change components for matched native before/after renders. It never constructs production data runtime or opens production account storage. Android native verification subsequently completed on a separate read-only emulator instance, as recorded below; the stale bridge AVD was unavailable, so the existing API35 compatibility AVD is used read-only without changing its source userdata.
- The independent App review found no Important code issue and one Compliance Nit for stale Web-only statements. Those statements are now marked as historical Web-phase evidence. Native rendered evidence and the explicit Mobile version decision are recorded below. At this intermediate checkpoint App hands-on acceptance was pending. The final acceptance and draft-delivery authorization are recorded below.


### Native iOS evidence

- The existing isolated email-OTP client on simulator `43510ED9-711F-479F-9BF2-ABAE38356754` (iOS 26.5) ran both current production components and task-frozen pre-change copies through a temporary Metro host on port 8086. The host uses in-memory synthetic responses and disabled provider/telemetry boundaries; it does not construct the normal production data runtime. Eight matched native before/after frames cover login/account in Chinese/English. Source digests and capture metadata are outside Git alongside the images.
- The Mac's native simulator view is provided by Device Hub; the standalone Simulator application is absent. Device Hub selected only the isolated OTP simulator. Genuine native input opened the account tab, activated the borderless email-binding entry, edited a synthetic address, observed Send become enabled, and cancelled back to the account methods. The lower-priority entry remains operable and its dialog behavior is intact. The AX value setter reported a transient error, but the subsequent native screenshot showed the address set and Send enabled; cancellation was then visibly confirmed.
- This is agent-executed native verification. It does not substitute for the requester's separate App hands-on acceptance, which was pending at this checkpoint and is recorded in the final acceptance section below. No real provider, mailbox delivery, production account, signing, or store publication was exercised.


### Mobile version decision

On 2026-11-12 the change requester explicitly declined a version/build increment and retained `1.0.30` / `805` (`previousBuildNumber: 804`). The manifest remains unchanged. These development-only presentation changes are intended to accompany a later App release, without a separate metadata-triggered build or publication in this task.


### Native Android evidence and final state

- The task-owned fixture project built its own Android debug client successfully in 9m53s (443 executed tasks) using the existing approved dependency versions. This build stays outside Git and uses `com.slax.reader.uifixture.emailotp`; it is not a publisher-signed production package.
- Installed only that isolated client on task emulator `emulator-5562`, a read-only API35 compatibility AVD instance. The existing `com.slax.reader` application was neither launched nor modified. Local reverse ports connect only to the task's Metro and local Web preview. No production account/database or real native provider was used.
- Eight valid matched Android native frames cover login/account, Chinese/English, before/after, with the same viewport, profile, fixture data, font settings, and harness controls. The first capture batch was obscured by Expo's first-launch developer-menu introduction and was invalidated. The temporary test host then used the installed public developer-menu API to dismiss that overlay and recaptured all eight frames; the remaining floating developer control belongs to the isolated debug client, not shipped UI.
- iOS and Android capture batches prepare states through the task-owned test-host controls and are labelled `nativeInteractionVerified: false`; the separate genuine iOS Device Hub tap/edit/cancel observations above are not conflated with those batch renders. Actual Android touch/keyboard gestures, real providers, publisher signing/release builds, physical-device behavior, and hosted integrations are not claimed. The changes are presentation-only and retain existing interaction owners.
- Matched pre-change component copies were independently compared with the pre-implementation baseline `89aee48f` and match its source bytes exactly. Current/baseline digests are recorded in `mobile-source-digests.json` outside Git. All screenshots and fixture build/Metro logs remain in the task's temporary evidence directory; no media, copied source, native project, compiler, or debug package is committed.
- Final independent App review found no Important issue; its stale Web-only documentation Nit was corrected and rechecked. Mobile checks, both-platform JS export, strict OpenSpec validation, and whitespace checks pass. Web hands-on acceptance and the Mobile no-bump decision are recorded; the separate App hands-on acceptance was subsequently supplied as recorded below.


## Final acceptance and draft delivery authorization (2026-11-12)

The change requester accepted Web after exercising the prepared local preview, then reviewed and authorized the additional native presentation scope. After receiving the implemented native preview with Device Hub open, native interaction evidence, and screenshot links, they responded affirmatively and requested one combined draft PR. This records the requester acceptance of the App extension before PR creation; it does not attribute additional specific gestures or the complete automated matrix to them. The approved refinements are provider-first order, quieter email entry/link controls, preserved native touch/interaction contracts, and unchanged App rollout. The prior Mobile no-version-increment decision remains authoritative.

A fresh fetch confirmed the task's pre-implementation baseline and latest `origin/dev` are still aligned at `89aee48f`. There are no upstream code changes requiring a rebase or invalidating the recorded Web/Mobile checks. Independent local Bugs/Security/Compliance reviews found no remaining Important or Nit findings. Draft PR preparation follows the repository template with matched before/after visuals, the explicit version decision, complete verification scope, and declared gaps. OpenSpec archive waits until after the task PR merges.
