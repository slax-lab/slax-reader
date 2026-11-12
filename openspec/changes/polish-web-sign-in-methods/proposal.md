# Proposal

## Why

The Web account sign-in methods and email login introduced by #541 need consistent hierarchy, recognizable controls, and usable compact layouts. With #577 merged, polish these Web test-environment surfaces and apply the requester's clarified development/preview rollout policy. The account subsection has been accepted, and the requester reviewed and authorized the email-login presentation extension.

## What Changes

- Keep sign-in methods in the existing profile card and preserve the page navigation, method order, binding endpoints, and verification steps.
- Give email, Google, and Apple a consistent leading icon, a name with secondary status beneath it, and a trailing binding action when available.
- Use the Web typography scale and semantic tokens for restrained hierarchy, explicit weights and line heights, theme-aware controls, and visible keyboard focus.
- Increase row padding so a 44px-or-taller action has breathing room above and below; keep separators between complete method groups, including an expanded email form.
- Present the expanded account email/address and code/verification controls as compact input-and-action rows, including at 320px; keep labels accessible and place supporting feedback beneath the controls.
- Preserve Chinese/English labels, long-address wrapping, binding success announcements and focus restoration, and all existing loading, error, and unavailable states.
- Refine the email login entry on the standalone page and modal: use the existing envelope icon, retain the method identity when expanded, and place low-emphasis cancellation beside it. Use compact labelled input/send and code/verify rows, with supporting feedback below.
- Show email login, code forms, and the complete account sign-in methods subsection in both development and preview Web profiles. Keep beta and production hidden, including already-linked identities. This applies the requester's clarified definition of test environments; API and Mobile rollout are unchanged.

## Capabilities

### New Capabilities

- `web-account-sign-in-methods`: Recognizable, accessible, theme-consistent presentation of the Web account sign-in methods subsection.
- `web-email-sign-in-presentation`: Consistent collapsed and expanded email login on the standalone page and shared modal, with compact controls and clear cancellation hierarchy.

### Modified Capabilities

The existing `email-authentication` delta remains owned solely by merged, unarchived `add-email-otp-auth`. Reconcile its Web rollout wording there to include preview, alongside this change's Web presentation requirements; do not create a second delta for the same capability. Archive the original authentication change before or together with this UI change. Authentication/API and native Mobile requirements otherwise remain intact.

## Impact

- Primarily `apps/web/app/components/UserSignInMethodsSection.vue`, the binding-specific presentation of shared `Login/EmailCodeForm.vue`, related existing tests, and application-owned icon assets/registry entries required by `AppIcon`. The requested login follow-up is limited to `Login/EmailLoginForm.vue` and deliberate compact presentation in `Login/EmailCodeForm.vue`; the already accepted account binding presentation is retained. The surrounding standalone login page and modal structure remain unchanged.
- Use the existing icon generator for generated registry output. No runtime dependency, API, contract, database, Mobile, or Extension changes are planned.
- Follow root `DESIGN.md`, especially Web tokens and typography (§4.2, §5), themes (§6), icon provenance/accessibility (§7), states (§8), and acceptance (§10.2).

## Review and Acceptance

The requester reviewed the proposal in conversation and authorized implementation on 2026-11-12, explicitly requesting a separate task branch. Implementation uses `fix/polish-web-sign-in-methods`, newly cut from `origin/dev` at `c1e5aa84` for this task. This is a local adjustment within the existing account-card pattern: no section relocation, navigation change, verification-flow change, or primary-action relocation is proposed. It falls under the local-component exception in `DESIGN.md` §10.1. Human hands-on acceptance of the implemented development preview is required before opening a PR; both account and login acceptances are recorded below and in `validation.md`.

On 2026-11-12, during hands-on review, the requester found the method rows improved but requested redesign and implementation of the expanded email form, specifically questioning full-width input and send-button rows. That account-only iteration kept the existing two verification stages and introduced side-by-side input/action controls for binding. The requester subsequently accepted the account scope and requested the separately reviewed login extension below.

The requester subsequently asked for another design analysis and better support for particularly small screens. A dedicated subagent identified forced action wrapping as the main density problem. The reviewed follow-up keeps three-column rows on small screens, quiets Cancel, aligns the form where space permits, and preserves full-width editing space at 320px. Visual refinement is through alignment, density, and existing type/color roles, with no additional decorative surfaces.

## Email Login Extension — Reviewed

On 2026-11-12 the requester stated that they were generally satisfied with the `/user` Sign-in methods subsection after exercising the prepared preview. This records acceptance of that account scope. They then requested a dedicated subagent design analysis and refinement of the login-page email module.

The proposed login extension affects both existing consumers of `EmailLoginForm`: add a decorative envelope to the existing entry; retain an email identity heading while expanded and keep cancellation as a trailing quiet control; use same-row labelled inputs and submit actions in both stages, with 96px minimum submit width to fit the 320px modal. Preserve the existing provider order separately in each host, invitation/Turnstile gating, modal benefits/legal content, abort behavior, authentication requests, attribution, return targets, the then-existing development-only gate (later expanded by the explicit preview correction below), and accepted account form.

On 2026-11-12 the requester reviewed the concrete login-extension description in conversation and explicitly authorized direct implementation. The approved scope is the icon-bearing entry, expanded email identity with trailing quiet cancellation, same-row address/send and code/verify controls, both existing login hosts, and supported phone widths while preserving authentication and rollout. The email-login implementation required its own hands-on acceptance before PR creation, subsequently supplied as recorded below.

## Final Review and Delivery Authorization

On 2026-11-12 the requester exercised the new login preview, accepted the UI as sufficient for this iteration, clarified that Web test environments include both development and preview, and requested one email-optimization PR covering all adjustments in this chat. That explicit environment correction is the implementation target; beta/production remain hidden. No new visual structure is introduced by widening the profile condition.


## Sequenced Follow-up: refine-email-login-flow

PR #584 and the original authentication task have merged. On 2026-11-12 the change requester requested the sequenced `refine-email-login-flow` follow-up: Web methods ordered Google, Apple, email; a quieter email entry/link action; last-successful-address prefill; non-repeatable successful verification during departure; and development/preview/beta Web availability with production hidden and App unchanged. The preceding rollout/order statements record the earlier delivered scope. The reconciled delta specs describe the proposed follow-up target; its implementation tasks, approval, and new hands-on acceptance belong to `refine-email-login-flow`. Keep single ownership of these capability deltas and archive them together after that follow-up merges.


The App-unchanged wording in the original Web follow-up records that phase's scope. After Web hands-on acceptance, the change requester separately reviewed and approved native provider-first order and quieter email entry/binding in `refine-email-login-flow`. Only that presentation exclusion is superseded; native development-only availability, credentials, sessions, and persistence remain unchanged. Native requirements remain solely in the `email-authentication` delta.
