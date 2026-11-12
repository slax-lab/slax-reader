# Proposal

## Why

The change requester wants Google sign-in to remain the preferred path while email becomes available to Web beta readers. Returning email users should not retype their last successful address, and a successful verification must not briefly expose an actionable Verify button while the browser is leaving the login screen.

## What Changes

- Order configured methods as Google, Apple, then email on the standalone login page, shared login modal, and `/user`. Preserve provider configuration rules and existing account status/actions.
- Present collapsed email login and the account's email-link action as quiet secondary controls using existing Web tokens. Preserve the envelope, readable contrast, visible focus, and 44px hit areas. Keep Send/Verify prominent once the reader deliberately enters the email flow.
- In App, retain Google/Apple/email login order, make the email entry borderless and subordinate, and move the account mailbox group after provider status/linking controls with a quieter binding action. Preserve Mobile touch targets, agreement and verification flows, and development-only visibility.
- Remember only the last successfully authenticated email address in this browser origin's local storage. Prefill it when opening an anonymous email-login form, allow editing, and replace it only after another successful email login. Do not save codes, challenges, tokens, failed attempts, or binding addresses; do not prefill account binding from an anonymous login preference.
- Keep verification and related email controls locked through successful session completion and whole-page navigation. Genuine verification failures remain retryable; existing cancellation and provider-switch behavior remain available before success.
- Offer Web email login and the whole account sign-in methods subsection in development, preview, and beta. Production remains hidden. The change requester explicitly confirmed that native App rollout stays unchanged.

## Capabilities

### New Capabilities

- `web-email-sign-in-continuation`: Remember the last successful login address and retain terminal verification state through navigation without changing identity/session ownership.

### Modified Capabilities

No corresponding main specs have been archived yet. The existing deltas for `web-email-sign-in-presentation` and `web-account-sign-in-methods` remain solely in merged `polish-web-sign-in-methods`; `email-authentication` remains solely in merged `add-email-otp-auth`. Reconcile their order, hierarchy, and Web beta policy there rather than creating parallel deltas for those capabilities. These predecessors have merged, so this is a sequenced follow-up. Archive their final reconciled deltas together with this change after its implementation merges, through a separate human-reviewed docs PR.

## Impact

- Web login hosts, `EmailLoginForm.vue`, shared `EmailCodeForm.vue`, `UserSignInMethodsSection.vue`, a small browser-preference boundary, and related tests.
- Reuses existing storage, session, return-target, referral/acquisition, invitation/Turnstile, provider configuration, and icon conventions. No new dependencies, API endpoints, contracts, backend configuration, native credential/session changes, or account data migration.
- Native presentation scope is limited to `LoginScreen.tsx`, `AccountSignInMethods.tsx`, and their existing mounted-host suites; retain Mobile-owned tokens rather than Web styles.
- Branch `fix/refine-email-login-flow` starts at `origin/dev` `89aee48f`, which includes merged PR #584.

## Review and Acceptance

On 2026-11-12 the change requester specified the five adjustments, confirmed Web-only beta availability with App unchanged, and chose review of the written proposal rather than a separate demo. The change requester reviewed this proposal and explicitly authorized implementation on 2026-11-12, requesting a running local preview before further delivery. The implemented UI will require fresh hands-on acceptance under `DESIGN.md` §10.2 before any new PR opens.


### App presentation extension after Web acceptance

On 2026-11-12 the change requester exercised the Web preview and accepted its implementation. They then requested the same provider preference in App. After reviewing the explicit scope in conversation, they authorized native login email as a borderless subordinate entry and account methods ordered providers before email, preserving touch areas and all agreement/verification contracts. This supersedes the previous App-presentation exclusion only; App beta availability, native remembered-address storage, and authentication logic remain outside scope. Fresh native runtime evidence and hands-on acceptance belong to this extension, not the accepted Web phase.


On 2026-11-12, after the App changes were prepared and checks passed, the change requester explicitly chose to retain Mobile version `1.0.30`, build `805`, and previous build `804`, with these development-only presentation refinements included in a later App release. No metadata increase, signing, upload, or publication is authorized by that decision.


### Combined draft delivery authorization

On 2026-11-12, after the prepared native implementation preview was handed off with Device Hub open and native screenshot links, the change requester responded affirmatively and explicitly requested one combined draft PR for all Web and App adjustments. This records acceptance of the App presentation extension following the earlier Web hands-on acceptance. No specific native gestures beyond that acceptance are attributed to the requester. Mobile version/build remain unchanged per the explicit decision above.
