# Email OTP verification

## Automated checks

- The full API Vitest run passed with 243 test files and 3,839 tests. The default run skips opt-in integration suites. The public error-envelope fixture was updated for the three additive error codes.
- The focused API run passed 54 tests with local PostgreSQL and Redis, including concurrent signup, OAuth versus email ownership, legacy Apple placeholders, 30-day reservations, case-preserving delivery, expiry, resend, attempt limits, and one-time consumption. Provider-link tests reject a wrong account, callback URL, or signed nonce, and reject a repeated callback. The API and shared contract type checks passed.
- After making email authentication available by default with its credentials, all 26 focused API tests passed. The availability test covers configured credentials, an absent Resend key, and a short verification secret. API type checking, lint, and strict OpenSpec validation passed.
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

- Real Resend delivery, Google/Apple authorizations, the deployed PowerSync filter, and native provider behavior require the configured environment and test accounts. No live email was sent.
- The Extension handoff was exercised in the Web fixture. The installed Extension was outside the preview environment.
- The standard iOS app build reached the application resource step and stopped because its Firebase `GoogleService-Info.plist` was unavailable in the worktree. The separate simulator fixture excludes that dependency.

## Mobile version

The requester chose to retain Mobile 1.0.29 with build number 803 and previous build number 802.

## Hands-on acceptance

On 2026-11-09 the requester exercised the initial Web preview and asked to refine the layout of `/user`. The revision groups profile details and sign-in methods in one card, separates the two email labels, and aligns the methods, status, and actions. The requester accepted the revised Web layout and binding flow in the loopback preview on 2026-11-09.

On 2026-11-09 the requester accepted the Mobile preview covering iOS email login and Android existing-account binding.

## Local review

The Bugs, Security, and Compliance passes matched the diff to `add-email-otp-auth`. The final diff addresses stale Web account ownership, cancelled Mobile session completion, provider subject precedence, and frozen Apple placeholder ownership. No unresolved Important finding remained in the local review.

The first automated review questioned whether the iOS Apple SDK hashes the provider nonce. The installed `expo-apple-authentication` 58.0.2 Swift source matched the published package. Its `AppleAuthenticationRequest.swift` sets `request.nonce = options.nonce`. Apple documents that the value sent in the native request returns in the signed identity token. The provider binding therefore compares that value with the server challenge. [Published Expo 58.0.2 package](https://registry.npmjs.org/expo-apple-authentication/-/expo-apple-authentication-58.0.2.tgz) · [Apple's native nonce description](https://developer.apple.com/videos/play/wwdc2020/10173/?time=1699)

The focused API run passed 25 tests, including the iOS provider-binding flow with two locally signed Apple identities and the nonce in the native credential. The nine Mobile provider tests passed, including passing the issued nonce through the Apple adapter. These checks use synthetic identities. Real Apple authorization remains part of configured-environment verification.
