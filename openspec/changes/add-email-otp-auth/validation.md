# Email OTP verification

## Automated checks

- The full API Vitest run passed with 243 test files and 3,839 tests. The default run skips opt-in integration suites. The public error-envelope fixture was updated for the three additive error codes.
- The focused API run passed 54 tests with local PostgreSQL and Redis, including concurrent signup, OAuth versus email ownership, legacy Apple placeholders, 30-day reservations, case-preserving delivery, expiry, resend, attempt limits, and one-time consumption. Provider-link tests reject a wrong account, callback URL, or signed nonce, and reject a repeated callback. The API and shared contract type checks passed.
- After making email authentication available by default with its then-required credentials, all 26 focused API tests passed. API type checking, lint, and strict OpenSpec validation passed.
- After changing the default sender to `Slax Reader <noreply@reader.slax.com>`, all 18 email-code tests passed, including the assertion on the outgoing Resend request. The local Worker HTTP acceptance suite also passed with its simulated Resend transport.
- After moving the Resend HTTP call to `infra/external/resend.ts`, all 35 layer architecture tests and 18 email-code tests passed. The full API suite passed 3,862 tests with 138 opt-in tests skipped. API type checking and the local Worker HTTP acceptance suite also passed.
- `pnpm api -- lint` exited successfully with warnings and no errors.
- Strict OpenSpec validation passed all 117 items.
- The generated agent configuration and workflow drift checks passed.
- The Web type check and development-profile build passed. The focused Web Vitest run passed 100 tests across seven suites, and ESLint passed for the changed Web files.
- `pnpm mobile -- check` passed all 1,292 tests with the Kotlin compiler on `PATH`. `pnpm mobile -- bundle` exported both platforms. `pnpm mobile -- test:native-resources` passed the Kotlin and Swift host checks.
- The isolated Android arm64 debug fixture passed Gradle `:app:assembleDebug`, including the updated `:slax-platform:compileDebugKotlin` task. The isolated unsigned iOS arm64 simulator fixture passed Xcode build. These builds used synthetic fixture profiles.
- The installed PowerSync service parsed both the base and proposed local rules with the same pre-existing warning. The platform-binding query keeps its current owner constraint and excludes `mail`.

## Running environment

- `EMAIL_AUTH_HTTP_SMOKE=1 pnpm api -- test:http` exercised the local Edge and Core Workers against disposable PostgreSQL, D1 and Redis. It used a Resend test transport that captured messages locally. The run passed with email credentials alone. An unbound historical account was directed to its existing login, a signed-in owner bound a mailbox and returned to the same user ID, and a new verified mailbox created a user and authenticated the owner-only identities endpoint. The unauthenticated identities request was rejected. Account cleanup retained the deleted user's mailbox reservation.
- Playwright exercised the built Web login page and account settings against a loopback API fixture at 1280 px in light, 768 px in dark, and 320 px in e-ink. It checked invalid-code recovery, a new account with its verified mailbox already linked, and an existing Google account that added a verified mailbox without changing its profile email or session. Simulated Google and Apple callbacks linked to the signed-in account in each layout. A Chinese-language run verified localized labels, focus, and error recovery. The extension launch fixture observed the existing session cookie and return target. The collection modal returned to a pending subscription after a fresh code succeeded.
- After the settings layout revision, Chromium verified aligned rows at 1280 px in light, the Chinese labels and a single displayed address for matching emails at 768 px in dark, and wrapping of distinct long addresses with no horizontal overflow at 320 px in e-ink. When the API reported email authentication unavailable, the sign-in subsection and its divider were hidden.
- The Android API 35 arm64 emulator ran the native preview. After accepting the agreement, an incorrect code showed a localized error and a correct code opened the library. Account settings showed the new account's verified address. In a separate legacy Google account fixture, verification added the mailbox while keeping Google linked and showed the Web instructions for linking Apple on Android.
- The iOS 26.5 arm64 simulator ran the native preview. The login screen showed the email entry and initially unchecked agreement. In the legacy account fixture, the binding dialog showed the numeric keyboard, resend timer, and localized invalid-code error. A correct code displayed the bound mailbox alongside the original Google login in the same settings session.
- Both native previews ran outside the Git worktree against the isolated fixture transport. The preview scaffold awaited Expo FileSystem's marker write and skipped unrelated article-cache seeding and clearing for the two authentication fixtures.

## Remaining verification and release checks

- Real Resend delivery, Google/Apple authorizations, and native provider behavior require the configured environment and test accounts. No live email was sent.
- The Extension handoff was exercised in the Web fixture. The installed Extension was outside the preview environment.
- The standard iOS app build reached the application resource step and stopped because its Firebase `GoogleService-Info.plist` was unavailable in the worktree. The separate simulator fixture excludes that dependency.

## Mobile version

The requester chose to retain Mobile 1.0.29 with build number 803 and previous build number 802.

## Development-only mailbox binding entry

- The earlier full API run passed 3,867 tests with 138 opt-in tests skipped. After limiting the rollout rule to presentation, all 42 focused API and architecture tests passed. The isolated Edge/Core HTTP smoke used fixture credentials and completed binding in dev, beta, and production. The identities response showed the action only in dev. API and shared contract type checks passed.
- The Web account settings, authentication composable, and server session endpoint passed 45 focused tests. The integration with the latest `dev` uses its server-set session cookie for both OAuth and email login. The tests cover canceled verification and an existing session taking precedence.
- Chromium exercised the account page against a local API fixture at 1280 px in light, 768 px in dark, and 320 px in e-ink. The binding action was hidden when disabled and completed with a verified address when enabled. The original Google binding remained visible in both states.
- The Mobile settings suite passed 20 tests, including binding on iOS and a hidden binding action with Google linking still available on Android. Mobile type checking and both platform bundles succeeded. The full local Mobile run failed in five unrelated native storage and transport harnesses. The full local Web run was stopped after Nuxt setup hooks timed out. The rollout adjustment has not been exercised on a physical device or a hosted deployment.
- The final presentation-only revision passed all six focused Web settings tests and 20 Mobile settings tests.

## Hands-on acceptance

On 2026-11-09 the requester exercised the initial Web preview and asked to refine the layout of `/user`. The revision groups profile details and sign-in methods in one card, separates the two email labels, and aligns the methods, status, and actions. The requester accepted the revised Web layout and binding flow in the loopback preview on 2026-11-09.

On 2026-11-09 the requester accepted the Mobile preview covering iOS email login and Android existing-account binding.

## Route and storage rewrite

- The default API suite passed 3,865 tests. The focused API run passed 102 tests with disposable Redis, covering layer boundaries, independent device quota, challenge expiration, concurrent proof redemption, and OAuth state consumption. The local PostgreSQL run passed all 21 account tests, including concurrent signup, binding, deletion, and credential revocation.
- The isolated Edge/Core HTTP smoke used one send route, the existing login, user information, and provider bind-link routes, and the authenticated bind route. It verified anonymous access boundaries, account reuse, new-account login, and beta and production binding with the UI hint hidden. Resend was simulated.
- Chromium exercised the updated Web login and settings flows using the local API fixture. It observed the device header on the shared send route, the email proof on the existing login route, the hidden binding action from user information, and successful binding with the Google session preserved. All 71 focused Web tests and 83 focused Mobile tests passed. API, Web, and Mobile type checks passed.
- The Mobile rewrite was exercised in the mounted host suite. Both platform bundles exported. The full local Mobile run passed 1,215 tests, skipped one, and timed out while the Swift offline engine fixture was waiting for article images. The same fixture passed in isolation. Native-device acceptance for this revision and live Resend delivery remain release verification items.

## Verification secret removal

- Removing the secret from the fixtures reproduced the old configuration failure. After the change, all 83 focused API tests passed with disposable Redis, including OTP expiry, failed attempts, one-time redemption, send limits, and provider binding.
- The local Edge/Core HTTP smoke used a fixture Resend API key alone and exercised email delivery, login, and binding. Resend delivery was captured locally. The default API suite passed 3,865 tests with 139 opt-in tests skipped. API type checking and targeted lint and formatting checks passed.

## Review follow-up

- PowerSync rules and platform-binding cleanup are identical to `dev`. The disposable PostgreSQL suite passed 25 tests, including the previous cleanup implementation's regression case. The current cleanup removes `mail` and other platform rows, permits registration with a distinct freed address, and preserves the original profile-email freeze.
- The 167 focused API tests passed with disposable Redis. They cover the email challenge's lifetime, rate limits and atomic consumption, provider state and nonce, Twitter replay protection and cleanup, and existing account behavior. The Redis integration tests now run from `test/infra`.
- The default API suite passed 3,860 tests with 143 skipped on a rerun with three workers. The earlier run encountered local suite and subprocess timeouts during concurrent verification. API type checking and targeted lint passed.
- `EMAIL_AUTH_HTTP_SMOKE=1 pnpm api -- test:http` passed against the local Edge and Core Workers with isolated PostgreSQL, D1, Redis, and captured Resend delivery. It verified the new send route, the existing login and settings routes, unauthorized binding rejection, the legacy language-setting response, provider challenge type and callback validation, binding in all three environment profiles, and deletion of all platform bindings.
- The full Web suite passed 2,742 tests, with three skipped. Browser verification exercised the local Nuxt preview with fixture mail: anonymous code issue with a device header, login through the existing session path, authenticated binding through account settings, and the development-only binding hint. Modal unit tests cover the original layout behavior, login cancellation, and collection continuation.
- Mobile passed 100 focused tests and 76 related host regressions. Both Hermes bundles exported. Full Mobile check passed architecture and type checking and 1,219 tests. The existing Kotlin image and PDF policy host tests timed out during compilation in the full run, then both passed on a serial rerun. The review follow-up used mounted host tests and fixtures. It did not run a new native-device acceptance session or live provider authorization.

## Code organization follow-up

- Moved email-code settings to `const/emailCode.ts` and code generation and message composition to `utils/emailCode.ts`. Mail templates use the existing i18n module. Renamed the Redis repositories to `EmailChallengeRepo` and `OAuthStateRepo`, then regenerated DI registrations.
- All 61 focused tests passed, including exact localized mail content, disposable Redis expiry and limits, provider binding, Twitter state handling, and architecture boundaries. API and shared-contract type checking passed. Targeted lint passed with one existing warning in `user.ts`. The local Edge/Core HTTP smoke passed with disposable databases and Redis and captured Resend delivery.

## Platform-list follow-up

- Removed the duplicate login-identities response and its derived booleans. The existing `platform` list now includes the login mailbox. Web and Mobile derive displayed methods from that list and use their own development profiles to control the mailbox binding action.
- Renamed the new linking service and its methods to `LoginIdentityLinkService.linkIdentity`, `linkLoginEmail`, and `linkLoginProvider`, and regenerated DI registrations.
- All 84 focused API tests passed. API and shared-contract type checking passed. The local Worker HTTP smoke verified mailbox entries through `platform` in dev, beta, and production, with captured email delivery. Chromium exercised login and existing-account linking with the platform-list response.
- Web passed 70 related tests, type checking, and targeted lint. Mobile passed 201 related transport, account settings, provider, and diagnostics tests, plus a final 57-test regression after the display lookup change. Final Mobile type checking and both Hermes bundles passed. The local full Mobile run was stopped after four Kotlin host tests could not find `kotlinc` and the remaining native suites caused host contention. The focused TypeScript and mounted tests remain the evidence for this revision.

## Local review

The Bugs, Security, and Compliance passes matched the diff to `add-email-otp-auth`. The final diff addresses stale Web account ownership, cancelled Mobile session completion, provider subject precedence, and frozen Apple placeholder ownership. No unresolved Important finding remained in the local review.

The first automated review questioned whether the iOS Apple SDK hashes the provider nonce. The installed `expo-apple-authentication` 58.0.2 Swift source matched the published package. Its `AppleAuthenticationRequest.swift` sets `request.nonce = options.nonce`. Apple documents that the value sent in the native request returns in the signed identity token. The provider binding therefore compares that value with the server challenge. [Published Expo 58.0.2 package](https://registry.npmjs.org/expo-apple-authentication/-/expo-apple-authentication-58.0.2.tgz) · [Apple's native nonce description](https://developer.apple.com/videos/play/wwdc2020/10173/?time=1699)

The focused API run passed 25 tests, including the iOS provider-binding flow with two locally signed Apple identities and the nonce in the native credential. The nine Mobile provider tests passed, including passing the issued nonce through the Apple adapter. These checks use synthetic identities. Real Apple authorization remains part of configured-environment verification.

## Development-only email UI correction (2026-11-11)

### Cause and scope

The earlier rollout restricted only the mailbox binding action. Web's shared email login form and Mobile's login button had no development check. Both settings views also displayed existing mailbox bindings in non-development environments. The correction gates email login and the complete new sign-in methods section using Web's existing `public.slaxEnv === 'development'` profile and Mobile's existing `config.development`. Original Google/Apple login entries and historical profile email remain unchanged. On 2026-11-11 the requester reviewed the initial correction and asked to hide the entire sign-in methods section, including its heading and new provider linking/status rows. The correction was adjusted accordingly. There are no API, contract, deployment configuration, environment-variable, or database changes.

### Automated evidence

- The new Web regression cases reproduced visible email login in preview, beta, and production, and visible linked mailbox status outside development. After the fix, the three focused suites (`LoginView.spec.ts`, `LoginModal.spec.ts`, and `UserSignInMethodsSection.spec.ts`) passed all 41 tests. Development login and binding flows remain covered.
- The Mobile mounted regression cases reproduced email login in beta and production on iOS and Android, and a linked mailbox displayed outside development. The focused `login-dismissal.test.mjs` and `settings-account.test.mjs` run passed all 57 tests after the correction.
- `pnpm web -- typecheck` and targeted Web ESLint passed. An additional unconfigured root Prettier check reported formatting differences for the five touched Web files; checking their `HEAD` versions confirmed the same pre-existing result. Formatting was not broadened into this behavior fix.
- `pnpm mobile -- check` passed architecture, baseline/fixture checks, type checking, and 1,227 tests; one test was skipped. Six unrelated Kotlin host tests failed because this environment has no `kotlinc` executable (`ENOENT`). No Kotlin or native integration was changed.
- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- bundle --max-workers 1` exported both Android and iOS Hermes bundles successfully.
- Strict OpenSpec validation passed all 134 items. `git diff --check` passed.

### Running environment

Chromium exercised the changed worktree against a loopback API fixture with synthetic Google/Apple configuration and no live email delivery. The Nuxt server was started separately with `SLAX_ENV=beta`, `SLAX_ENV=production`, and `SLAX_ENV=development`; each profile was checked at 1280 px/light, 768 px/dark, and 320 px/e-ink. Each combination covered the login page, unbound account settings, and an account whose API response already included a `mail` binding.

- Beta and production omitted email login entries and email inputs and the entire new account sign-in methods section. Original Google and Apple login entries remained visible. Historical profile email remained visible in the existing profile area.
- Development retained the email entry and displayed the existing mailbox or its binding action. A separate development browser flow sent a code with a device ID, logged in through the existing session flow, and bound another address through account settings while preserving the Google identity.
- Merely opening the pages did not send an email or attempt email login. Fixture addresses and code `012345` were used; Resend was not contacted.
- Login modal behavior was verified through its mounted Vue suite, not a new browser-modal session. No hosted deployment, real provider authorization, or new native-device session was exercised for this presentation-only correction. Backend availability was not re-exercised against live services; the backend is unchanged.

### Review and handoff

The whole-section follow-up reproduced the previously visible section heading and provider rows in mounted Web and Mobile tests before the component-level gates were added. The final focused suites, type checks, and both platform bundles were re-run after that adjustment. The local Bugs and Security passes found no additional issue in the four changed presentation files. The Compliance pass matches the corrected rollout requirements under `add-email-otp-auth`; hands-on acceptance of this follow-up remains pending. The earlier feature PR #541 is already merged, so this correction uses the separate `fix/dev-only-email-ui` branch based on current `origin/dev`. Its follow-up PR will not open before the required acceptance and will be created as a Draft PR as the requester instructed. No version files were changed, following the requester's existing preference to retain the Mobile version.
