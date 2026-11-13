# Web Email Login Refinement Verification

The original 2026-11-12 rollout evidence below is historical. The 2026-11-13 amendment at the end of this record supersedes its production/native exclusions.

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


## Draft delivery and task-owned cleanup

- Created [draft PR #597](https://github.com/slax-lab/slax-reader/pull/597) targeting `dev`, combining the approved Web and App refinements. At initial delivery the PR was explicitly a draft, with eight uploaded matched images, this verification record, and the no-version-increment decision. GitHub draft state, base/head branches, and all eight remote image references were checked after creation.
- Preserved the task's isolated Android debug package, native screenshots, source digests, capture records, and build/check logs outside Git. After delivery, removed only the identified temporary Android project build directories and its project-local Gradle cache; stopped only the task's read-only emulator instance. The source AVD, installed production App, shared/global dependency caches, and other tasks were not changed. Removed the redundant compiler download archive while retaining the temporary compiler used for verification.
- The worktree and local Web/iOS preview infrastructure remain available for draft iteration. The separate fixture package is diagnostic preview output, not a production release or publication. OpenSpec changes remain unarchived until after task merge and a separate human-reviewed docs PR.


## All-environment availability amendment — 2026-11-13

### Authorization and implementation

The requester explicitly decided, after discussion, to remove environment restrictions and make email functionality available in every environment. This applies to Web login/page/modal/account binding and iOS/Android login/account binding, including production, and supersedes the previous Web-only beta/native-development policy. The accepted method styling and order are retained; Google/configured Apple remain ahead of the quiet email entry. Native login also extends its existing email-enabled `ScrollView` to normal non-development clients, replacing their fixed content `View` and using the existing `scrollContent`/`scrollTop` flex-growth styles. This update continued the same branch and PR #597, which was still a draft at that implementation checkpoint. The requester’s earlier explicit Mobile no-bump decision remains `1.0.30` / build `805` / previous `804`.

Removed both Web rendering predicates, the Mobile login development predicate, the Mobile account-section development predicate, and the `useLinkedPlatforms.openEmail` development guard/option. Retained fixture-only isolation, loaded-platform readiness, existing-mailbox, current-account, mutation, provider configuration/callback, and API/session checks. Existing fixtures do not become real authentication clients. The three normative capability deltas retain their single predecessor owners. No styles, assets, dependencies, backend code, API contracts, configuration credentials, or version metadata changed in this amendment.

### Regression-first and automated verification

- Updated the existing Web full login and attributed modal continuation/binding cases to include production, plus already-bound identity display. Before removing gates, 4 cases failed and 46 passed; after removal, all 100 tests in the five affected login/modal/account/page/auth suites passed.
- Native mounted login now checks iOS/Android availability in development, preview, beta, and production. Settings additionally exercises real `SettingsScreen → useLinkedPlatforms → EmailCodeDialog` mailbox binding and provider linking with `development=false`, preserving the session, and displays linked identities without confusing mail collection with login mail. Before removing gates, 9 cases failed and 55 passed; afterward all 64 focused login/settings cases passed.
- Web type checking and targeted ESLint exited 0. Strict OpenSpec validation passed all 142 items.

### Running-client verification

The actual Nuxt preview ran with `SLAX_ENV=production` and explicit synthetic public configuration at localhost:3287, backed only by the loopback fixture at localhost:8894. Both actual login hosts completed code authentication, retained one remembered successful address across synthetic logout, preserved it after wrong-code failure, and retained the terminal disabled controls/no duplicate verification while an aborted destination navigation kept the old document inspectable. The original destination committed afterward. A separate 320px account smoke completed binding, restored focus/announcement, and confirmed the anonymous remembered address neither prefills nor changes during binding.

An isolated iOS26.5 native client rendered current production components with `config.development=false`: Chinese/English login and account methods remain visible, Google/Apple precede email, and the quiet entry/binding appearance matches the accepted UI. Four frames were captured outside Git and the Chinese login/account frames were visually inspected. Task-host controls prepare states programmatically; this does not claim new user gestures or a production native binary.

### Review, acceptance, and limits

An independent local reviewer completed Bugs/Security/Compliance passes on this amendment and found no Important or actionable Nit findings. The existing Web/App hands-on acceptance before draft creation remains recorded above; on 2026-11-13 the requester explicitly amended availability without requesting visual changes. The accepted development captures remain representative of the method styling/order and existing email-enabled scroll container. In normal non-development native clients, that scroll container replaces the earlier fixed content container; no fresh native Android scroll/gesture verification is claimed.

No hosted production/beta deployment, live email delivery, actual Google/Apple authorization, physical-device Release run, signing, or store publication was performed. Fixtures exercise client behavior without proving server credentials or inbox delivery. Earlier profile-omission evidence is historical and is not claimed as the current target.

Additional amendment limitations: the isolated Android API35 diagnostic APK installed and launched, but its temporary host stayed blank before connecting a Metro inspector target under local resource contention. No fresh Android native render or gesture success is claimed for this amendment; the earlier accepted Android renders remain historical. The non-development Android mounted login and real settings controller regressions, plus the fresh Android production JS export, cover the changed availability logic. The task-owned read-only emulator was stopped; the source AVD and installed production app were not modified.

The initial simultaneous full Web/native checks and bundlers caused local resource contention: the Web run encountered timeouts, a native Kotlin host exceeded its 120-second bound, and the runs were stopped. Web was restarted with `--maxWorkers=2`; native checks were restarted after stopping competing task processes; the export used `--max-workers 2`. No product test deadlines, expected results, or application code were changed to accommodate resource pressure.

### Final amendment check results

- `/tmp/slax-signin-run.sh pnpm web -- test --maxWorkers=2`: 240 files passed, one skipped; **2,902 tests passed, three skipped**. The complete run includes the previously timed-out imports/cold-start cases. The known happy-dom teardown diagnostic did not fail a test or the process.
- `PATH=/tmp/slax-email-followup-toolchain/kotlinc/bin:$PATH SLAX_KOTLINC=/tmp/slax-email-followup-toolchain/kotlinc/bin/kotlinc SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- check`: architecture, assets, fixture, RSS, type checks and **1,242 passing tests, three skipped**, exit 0. Native Kotlin/Swift host checks passed after competing task processes were stopped.
- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- bundle --max-workers 2`: Android and iOS Hermes exports succeeded, exit 0. No native rebuild is required for these JavaScript-only predicate removals; no native module boundary changed.
- Web type checking, targeted ESLint, strict OpenSpec validation (142 items), and `git diff --check` passed. The five focused Web suites passed 100 tests; focused native login/settings passed 64. Logs, synthetic harnesses, native diagnostic APK and captures remain outside Git under `/tmp/slax-email-all-env-*` and `/tmp/slax-email-followup-evidence/`.

The final independent pre-push review rechecked the completed evidence and found no Important, Compliance, or actionable Nit findings. PR #597, still a draft at that checkpoint, was updated with the all-environment policy and fresh results, retaining the accepted visuals and `dev` target.


## Reviewer documentation follow-up — 2026-11-13

- GitHub’s PR timeline records a `ready_for_review` event by `Whyjsee` at `2026-11-13T00:52:06Z`. The current PR is ready for review. Updated the body/current-state wording and annotated historical draft delivery rather than reverting that explicit transition.
- Task 1.3 now states that the beta-only intermediate implementation was replaced by section 6; the related historical omission checks are labelled at their task entries rather than only in the section preamble.
- Confirmed directly in `LoginScreen.tsx` that `emailEnabled` selects both entry/dialog availability and the root content container. Normal non-development login now uses the existing email-enabled `ScrollView` with `scrollContent`/`scrollTop`, instead of the fixed content `View`. The record distinguishes unchanged method styling/order from this expanded scrolling behavior and keeps the native Android verification gap explicit.
- Deployment reminders were checked against `apps/api/src/domain/emailCode.ts` and `apps/api/src/const/emailCode.ts`: `RESEND_API_KEY` and the Redis-backed challenge path are required for working delivery; `EMAIL_AUTH_FROM` is optional and falls back to the existing `defaultFrom`. Sender/domain deliverability and hosted production configuration were not verified. Existing limits remain 30 sends/IP/hour and 500 sends/environment/day; production capacity suitability was not measured, and no limit/configuration changes were made.
- This follow-up changes documentation and PR metadata only. Runtime/type/lint/bundle reruns are exempt; the previously recorded running-client and automated results remain historical evidence for unchanged code. Strict OpenSpec validation and `git diff --check` verify this documentation follow-up.

The documentation follow-up passed `openspec validate --all --strict` (142 items, zero failures) and `git diff --check`. Independent Bugs/Security/Compliance review found no Important or remaining Nit findings.


## Initial per-IP send ceiling — 2026-11-13 (historical; superseded by 50/hour below)

The requester explicitly approved only `ipSendLimit: 30 → 300` requests per hour, keeping every other guard unchanged and updating PR #597. This supersedes the historical 30/hour IP figure in earlier review notes. The change is one production constant; the existing Redis key scope, counter increment/expiry behavior and delivery error handling are unchanged. No new configuration, dependency, API contract, UI change, production deployment, live email send, or application version update is included. API-only changes do not use package-version increments under `docs/release/VERSIONING.md`.

### Automated checks

- Regression-first service tests for both login and binding failed on the old ceiling: two failures at request count 31, 11 passes, 13 opt-in Redis skips. After the one-line change, the domain and real-Redis integration suites passed **26 tests with zero skips** using `EMAIL_OTP_REDIS_TEST=1`. Tests cover counts 31/300/301, distinct addresses/devices sharing an IP, login/binding sharing the production-environment IP quota, existing one-hour expiry, and the unchanged address/device/environment/cooldown/verification guards.
- Command: `PATH=/tmp/slax-email-ip-limit-toolchain/redis-stable/src:$PATH EMAIL_OTP_REDIS_TEST=1 pnpm --dir apps/api test test/domain/emailCode.test.ts test/infra/emailChallengeRedis.integration.test.ts --maxWorkers=2`. Both existing email suites ran with the real Redis opt-in enabled; no route-suite execution is claimed.
- API/contracts type checking exited 0 after generating the existing Prisma clients through `gen:model` with dotenv loading explicitly disabled and synthetic local database URLs. The first type attempt lacked these generated clients; no product types were changed to accommodate that prerequisite.
- ESLint passed the production constant. Tests are intentionally excluded by the API ESLint configuration; Prettier checking passed all three changed TypeScript files. Strict OpenSpec validation and whitespace validation passed.

### Running local service verification

A separate loopback HTTP fixture exercised the real `EmailCodeService`, `EmailChallengeRepo`, and `RedisClient`, backed by a disposable Redis 8.10.2 instance through the existing Upstash-compatible local REST fixture. `RUN_TYPE=prod` and all credentials/addresses were synthetic. The fixture alternated login/binding for **301 distinct mailbox/device requests from the same IP** without seeding counts: requests 1–300 returned HTTP 200, request 301 returned HTTP 429, and exactly 300 synthetic deliveries occurred. Thus the old 31st-request obstruction is removed and the 301st is stopped before delivery. The fixture and Redis were disposed after completion.

The HTTP adapter is a task-local harness around the production service/repository, not the complete Core Worker router/session/database stack. It does not claim a production traffic capacity measurement or new end-to-end account-binding verification. Existing route/UI acceptance remains historical evidence for unchanged code. Real Resend delivery and hosted sender/domain validity were not exercised. Harnesses, logs and the temporary Redis toolchain remain outside Git under `/tmp/slax-email-ip-limit-*`.

### Production configuration metadata check

A read-only `wrangler secret list --name reader-core` in an isolated temporary directory confirmed that `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` names exist on the Core Worker. Only secret names were inspected, never values. `EMAIL_AUTH_FROM` is not a secret there and retains its existing code fallback (a public variable override was not inspected). This establishes binding-name presence only; it does not prove credential validity, Redis reachability, sender verification, provider plan capacity, or inbox delivery. No remote configuration was modified.

Independent pre-push Bugs/Security/Compliance review found no Important or Nit findings. Strict validation passed all 142 items; whitespace checks passed. PR #597’s Test plan was updated for the approved 300/hour IP-only adjustment, keeping its ready-for-review state and original target.


## Final shared-IP ceiling: 50/hour — 2026-11-13

The requester explicitly replaced the intermediate 300/hour IP ceiling with **50/hour**, retaining every other rule and requesting submission to PR #597. The production diff from the previous head is only `ipSendLimit: 300 → 50`. The original 30/hour restriction is still relaxed; all address/device/environment quotas, cooldown, expiry, attempts, and environment/purpose counter scopes are unchanged. No UI, dependencies, contracts, version metadata, live configuration or deployment changed.

- Updated login/binding rejection regressions first: both domain cases failed against the intermediate 300 ceiling because request 51 was admitted. Initial Redis attempts could not start because the earlier temporary Redis toolchain was absent; its hook failures/skips were prerequisite failures, not a pass. Rebuilt Redis from its official source distribution in a task-only temporary directory, without system installation or application dependency changes.
- `PATH=/tmp/slax-email-ip50-toolchain/redis-stable/src:$PATH EMAIL_OTP_REDIS_TEST=1 pnpm --dir apps/api test test/domain/emailCode.test.ts test/infra/emailChallengeRedis.integration.test.ts --maxWorkers=2`: **26 passed, zero skipped**, exit 0. Both purposes, distinct devices/addresses sharing an IP, 31/50/51 boundaries, the one-hour counter expiry, and all existing other-guard cases are covered.
- Fresh independent localhost HTTP/service/repository/real-Redis exercise, with `RUN_TYPE=prod` and synthetic credentials/delivery: 50 distinct mailbox/device requests from one IP alternating login and binding returned 200; request 51 returned 429 before delivery. Exactly 50 synthetic deliveries occurred, without counter seeding. The harness and Redis instance were disposed. This is the same bounded service-level runtime scope as the earlier harness, not a complete Core Worker route/session test or live mail-delivery test.
- API/contracts type checking, production-constant ESLint, changed-file Prettier, strict OpenSpec validation, and whitespace checks passed. Web/Mobile code did not change, so their earlier acceptance remains historical and no fresh UI/native checks are claimed. API-only package-version exemption and the existing Mobile version decision remain applicable. Logs/harness/toolchain are outside Git under `/tmp/slax-email-ip50-*`.

Final 50/hour pre-push review completed Bugs/Security/Compliance passes with no Important or Nit findings. Strict validation passed all 142 items and whitespace checks passed. PR #597’s summary and Test plan now describe the final 50/51 boundary, superseding the intermediate 300 target and retaining its ready-for-review state.
