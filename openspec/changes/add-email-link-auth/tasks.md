# Tasks

## 1. Review checkpoint

- [x] 1.1 Obtain human review of this proposal before implementation; offer the optional Web/native entry-flow demo under `DESIGN.md` §10.1 and, if accepted, incorporate its feedback before dependent work. Verify the agreed scope and any accepted demo approval are recorded.

## 2. Existing API and challenge owners

- [x] 2.1 Extend the existing email contract with explicit link-proof DTOs and the existing login request union; keep route constants, send inputs/responses, binding proofs, and login results compatible. Verify shared-contract type checks and existing OTP callers.
- [x] 2.2 Add login-only link generation/message content in the existing const/utils/domain owners and `linkDigest` storage in `EmailChallengeRepo`. Verify `test/domain/emailCode.test.ts` covers one combined email, code-only binding, unchanged send metadata/limits, and no proof in the send response.
- [x] 2.3 Add link verification to `EmailCodeService` and dispatch through `UserService.userLogin` into `loginByVerifiedEmail`. Verify new/returning/blocked-address cases use the existing identity policy and no new account-binding path or auth endpoint is introduced.
- [x] 2.4 Extend `test/infra/emailChallengeRedis.integration.test.ts` for expiry, replacement, shared attempts, and competing valid OTP/link consumption; keep real Redis setup in infra tests. Run the affected domain/infra suites, `pnpm api -- gen:all`, and `pnpm api -- test test/script/layerArchitecture.test.ts`; inspect generated drift without adding architecture baseline exceptions.

- [x] 2.5 Extend the prerequisite internal-domain code log with its login link while skipping Resend; verify matching code/link digests, unchanged scope/response, and real Worker log-link login with replay rejection.

## 3. Web entry

- [x] 3.1 Add a focused email-link URL parser and early client capture/scrub entry, plus exact public middleware/startup classification for the canonical page and its browser-only alias. Verify malformed input is rejected before submission and actual built-page startup removes proof values before GTM/telemetry without initializing unauthenticated account data.
- [x] 3.2 Add `pages/email-login.vue`, a focused flow composable, and typed link submission through existing `useAuth`. Verify success, current-session guidance/no submission, invalid/used/expired proof, transport failure, disposal, and late-result handling with mounted tests and a running browser. Preserve ordinary OTP destinations and existing provider callbacks.

## 4. Native entry and associations

- [x] 4.1 Add a small Linking adapter and focused auth lifecycle hook wired at composition, using the existing API/session ports and agreement policy. Resolve the expected Web origin from the active API selection; verify primary, development/preview, Beta with a production Web config, and identical primary/Beta API configurations. Mounted-host tests must cover initial/warm URLs, duplicate active delivery, session readiness, authenticated-session refusal, agreement-before-submit and refusal/disposal, browser-only continuation for another known environment, unknown-origin rejection, and cancellation on owner replacement; screens must not own account transitions.
- [x] 4.2 Extend Expo source configuration with iOS `applinks:` domains and exact-path Android verified intent filters; extend existing AASA/Digital Asset Links while preserving Passkey entries and fingerprints. Verify generated native configuration and anonymous 200 JSON association responses for preview, beta, and production build outputs; do not add certificate trust or hand-edit generated files.
- [ ] 4.3 Verify Web fallback and cold/warm entry on signed iOS and Android targets, including current-session guidance and successful login to the existing account. Confirm Mobile version with the human before package delivery; run `pnpm mobile -- check`, `pnpm mobile -- bundle`, affected native-resource/build checks, and record any native routing limitation accurately.

  Progress on 2026-11-18: signed iPhone 12 warm entry, current-session protection and cold startup returning to the existing account passed human testing with actual delivered links. Mobile 1.0.33 (808) and build checks are recorded in `validation.md`. The requester deferred complete Android verification until a Play Beta package; this task remains open.

## 5. End-to-end acceptance and delivery

- [ ] 5.1 Exercise a delivered Resend email, its fragment link, OTP/link mutual consumption, fresh-email recovery, App entry, and browser fallback in a running environment. Check the configured sender and disabled click tracking with the operator; verify ordinary proof values do not reach analytics/logs (only the explicitly requested internal-domain issuance log is exempt) and no GET consumes proof. Record evidence in `validation.md` and identify any public-association publication dependency before seeking approval for a separate support Draft PR.
- [ ] 5.2 Obtain human hands-on acceptance for the changed Web/iOS/Android flows before opening the feature Draft PR, including the required Web themes/widths and existing-session branch. Resolve requested adjustments; record who, when, scope, and results in `validation.md`.

  Progress on 2026-11-18: Web and the exercised signed iPhone flows have requester acceptance. Real Resend delivery and QQ Web fragment preservation passed; native-mail-client-specific interaction and Android acceptance are not claimed. The requester explicitly authorized opening the feature Draft PR first, with Android acceptance deferred to Play Beta. This task remains open for that follow-up.

- [ ] 5.3 Run scoped type/lint checks, `pnpm exec openspec validate --all --strict`, and `git diff --check`; perform the Bugs/Security/Compliance pre-push review from `REVIEW.md`, explicitly checking names, file placement, layer responsibilities, call order, and unrelated edits. Resolve Important findings and deliver one task Draft PR targeting `dev`; do not merge or archive it automatically.
