# Proposal

## Why

The change requester wants Google sign-in to remain the preferred path while email becomes available in every Web and native App environment. Returning email users should not retype their last successful address, and a successful verification must not briefly expose an actionable Verify button while the browser is leaving the login screen.

## What Changes

- Order configured methods as Google, Apple, then email on the standalone login page, shared login modal, and `/user`. Preserve provider configuration rules and existing account status/actions.
- Present collapsed email login and the account's email-link action as quiet secondary controls using existing Web tokens. Preserve the envelope, readable contrast, visible focus, and 44px hit areas. Keep Send/Verify prominent once the reader deliberately enters the email flow.
- In App, retain Google/Apple/email login order, make the email entry borderless and subordinate, and move the account mailbox group after provider status/linking controls with a quieter binding action. Preserve Mobile touch targets, agreement and verification flows, and fixture isolation.
- Remember only the last successfully authenticated email address in this browser origin's local storage. Prefill it when opening an anonymous email-login form, allow editing, and replace it only after another successful email login. Do not save codes, challenges, tokens, failed attempts, or binding addresses; do not prefill account binding from an anonymous login preference.
- Keep verification and related email controls locked through successful session completion and whole-page navigation. Genuine verification failures remain retryable; existing cancellation and provider-switch behavior remain available before success.
- Offer email login and the complete account sign-in methods subsection in all Web, iOS, and Android environments, including production. Remove client environment predicates and the native binding-controller development check; preserve fixture-only isolation and existing authentication/account constraints.

## Capabilities

### New Capabilities

- `web-email-sign-in-continuation`: Remember the last successful login address and retain terminal verification state through navigation without changing identity/session ownership.

### Modified Capabilities

No corresponding main specs have been archived yet. The existing deltas for `web-email-sign-in-presentation` and `web-account-sign-in-methods` remain solely in merged `polish-web-sign-in-methods`; `email-authentication` remains solely in merged `add-email-otp-auth`. Reconcile their order, hierarchy, and all-environment client availability there rather than creating parallel deltas for those capabilities. These predecessors have merged, so this is a sequenced follow-up. Archive their final reconciled deltas together with this change after its implementation merges, through a separate human-reviewed docs PR.

## Impact

- Web login hosts, `EmailLoginForm.vue`, shared `EmailCodeForm.vue`, `UserSignInMethodsSection.vue`, a small browser-preference boundary, and related tests.
- Reuses existing storage, session, return-target, referral/acquisition, invitation/Turnstile, provider configuration, and icon conventions. No new dependencies, API endpoints, contracts, backend configuration, native credential/session changes, or account data migration.
- Native scope includes `LoginScreen.tsx`, `AccountSignInMethods.tsx`, `SettingsScreen.tsx`, `useLinkedPlatforms.ts`, and their existing mounted-host suites; retain Mobile-owned tokens rather than Web styles.
- Branch `fix/refine-email-login-flow` starts at `origin/dev` `89aee48f`, which includes merged PR #584.

## Review and Acceptance

On 2026-11-12 the change requester specified the five adjustments, confirmed Web-only beta availability with App unchanged, and chose review of the written proposal rather than a separate demo. The change requester reviewed this proposal and explicitly authorized implementation on 2026-11-12, requesting a running local preview before further delivery. The implemented UI will require fresh hands-on acceptance under `DESIGN.md` §10.2 before any new PR opens.


### App presentation extension after Web acceptance

On 2026-11-12 the change requester exercised the Web preview and accepted its implementation. They then requested the same provider preference in App. After reviewing the explicit scope in conversation, they authorized native login email as a borderless subordinate entry and account methods ordered providers before email, preserving touch areas and all agreement/verification contracts. This supersedes the previous App-presentation exclusion only; App beta availability, native remembered-address storage, and authentication logic remain outside scope. Fresh native runtime evidence and hands-on acceptance belong to this extension, not the accepted Web phase.


On 2026-11-12, after the App changes were prepared and checks passed, the change requester explicitly chose to retain Mobile version `1.0.30`, build `805`, and previous build `804`, with these development-only presentation refinements included in a later App release. No metadata increase, signing, upload, or publication is authorized by that decision.


### Combined draft delivery authorization

On 2026-11-12, after the prepared native implementation preview was handed off with Device Hub open and native screenshot links, the change requester responded affirmatively and explicitly requested one combined draft PR for all Web and App adjustments. This records acceptance of the App presentation extension following the earlier Web hands-on acceptance. No specific native gestures beyond that acceptance are attributed to the requester. Mobile version/build remain unchanged per the explicit decision above.


### All-environment availability amendment (2026-11-13)

After discussing rollout, the requester explicitly decided to remove environment restrictions and open email functionality in every environment. This supersedes all earlier Web-production and native non-development exclusions in this change and its reconciled predecessor deltas. Apply it to Web login/page/modal/account binding and native iOS/Android login/account binding; preserve the previously accepted provider-first presentation, remembered Web address, verification departure lock, fixture isolation, and account ownership checks. This amendment retains the accepted method styling/order and updates the same PR #597, which was still a draft at that implementation checkpoint. In Mobile it also extends the existing email-enabled scroll container to ordinary non-development clients, replacing their fixed content container. The existing Mobile decision to retain `1.0.30` / build `805` / previous `804` continues for this task; no signing, publication, or deployment is requested. Fresh all-environment regression and runtime evidence is tracked in section 6 of `tasks.md`.


### Review-state reconciliation (2026-11-13)

The PR timeline records that `Whyjsee` marked #597 ready for review at `2026-11-13T00:52:06Z`. Its current state is ready for review; the earlier draft authorization and draft-delivery records describe the original delivery, not a continuing state requirement. The reviewer follow-up corrects documentation only, explicitly marks superseded rollout tasks, and states the native scroll-container effect. It does not alter behavior, prior acceptance, or the Mobile version decision.
