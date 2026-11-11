# Tasks

## 1. Account identity

- [x] 1.1 Implement transactional lookup, registration, and explicit mailbox binding using the existing platform table. Exercise new, existing, ambiguous, frozen, and concurrent claims.
- [x] 1.2 Update Google and Apple account resolution and explicit linking. Exercise subject-first login, Apple placeholder recovery, provider conflicts, and repeated callbacks.
- [x] 1.3 Verify account cleanup removes every platform binding and preserves the existing profile-email freeze. Verify mail-collection isolation.

## 2. Email proof and API

- [x] 2.1 Implement Redis challenge issue, expiration, cooldown, attempt counting, rate limits and atomic consumption. Exercise expiry, resend, simultaneous submission, and distinct login and binding scopes.
- [x] 2.2 Implement the Resend sender and localized code templates. Exercise accepted, rejected and ambiguous sends using the local sender test seam.
- [x] 2.3 Add the delivery endpoint and reuse login, account settings, user information, and provider binding initiation. Regenerate backend registration and validate session, telemetry and client contracts.
- [x] 2.4 Remove the separate verification secret from email authentication and verify delivery and redemption with the Resend API key alone.

## 3. Client integration

- [x] 3.1 Add email-code login to the Web page and modal and explicit linking to account settings. Verify localized states, navigation, accessibility and Extension session handoff.
- [x] 3.2 Add native Mobile OTP login and account settings linking. Verify existing agreements, cancellation and session safeguards, provider support on each OS, and account continuity.

## 4. Running verification and review

- [x] 4.1 Run affected automated checks and strict OpenSpec validation. Exercise the feature against a running API and the supported clients, and record results in `validation.md`.
- [x] 4.2 Obtain and record hands-on acceptance for the changed UI. Confirm any affected package version changes before commit or push, and complete the local pre-push review.

## 5. Development-only email UI correction

- [x] 5.1 Hide email login entries and forms on non-development Web and Mobile clients; hide mailbox binding and linked login-email status in account settings. Preserve provider login and keep backend APIs unrestricted by the rollout environment.
- [x] 5.2 Verify development, beta, and production presentation, run affected checks, and record the correction evidence.
- [ ] 5.3 Obtain hands-on acceptance of the correction before opening its follow-up pull request.
