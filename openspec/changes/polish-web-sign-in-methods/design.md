# Design

## Context

See `proposal.md` for motivation and scope. The baseline is `origin/dev` at `c1e5aa84`, including merged #577. `UserSignInMethodsSection.vue` renders all methods only when `public.slaxEnv === 'development'`. It already owns account-scoped binding, provider callback availability, error handling, and focus restoration; none of those mechanisms needs replacement.

The current row has a 48px minimum height, 2px vertical padding, and a 44px minimum-height button. Names and statuses occupy competing columns, and the template uses `strong` without an explicit local weight. Root `DESIGN.md` owns the design intent. This document specifies only its application to this subsection; it does not introduce a second design system.

## Goals / Non-Goals

**Goals:** Make method identity and state scannable, provide practical separator clearance, and preserve accessible binding in every supported Web theme and width.

**Non-Goals:** Moving the subsection; changing authentication, backend/native rollout, profile-email semantics, the surrounding login page/modal structure, or Mobile/Extension presentation; introducing fonts, dependencies, global token changes, or decorative animation.

## Decisions

### 1. Keep one account card and one complete group per method

Retain the subsection heading and the email/Google/Apple order. Inside each method group, use a grid with a 32px leading icon slot, a flexible text column, and an intrinsic-width trailing action. Render the icon itself at 20px, with its name above secondary status. Keep the existing actions and translations, including the cancellation label while email is expanded.

Group the email row and its expanded form together so the next separator follows the whole email flow. Use at least 12px of vertical padding around row content; a 44px button therefore gives a minimum row height of 68px. Align the email form with the text column when room allows, retain its existing 420px maximum width, and use the available card width on narrow screens. Keep group separators subtle through `--slax-border`.

This replaces the current label/status columns with one readable text stack. Separate tiles or a relocated settings card would introduce unnecessary surface hierarchy; icon-only actions would obscure the binding operation.

### 2. Apply the existing type scale explicitly

Use `--slax-font-sans` throughout this functional subsection. Use `--slax-fs-body` at weight 500 for its nested heading, `--slax-fs-meta` at weight 500 for method names and actions, and `--slax-fs-aux` at weight 400 for statuses and supporting notes. Use a 1.5 line height for predictable wrapping. The existing serif account/page headings remain the higher hierarchy.

Use `--slax-text` for names/actions and `--slax-text-muted` for subordinate text. Preserve existing surface, border, radius, accent, and danger tokens. Keep the existing bordered secondary-control treatment, 44px minimum hit-area height, and focus ring. Explicit weights avoid the browser's uncontrolled `strong` emphasis without introducing new size roles.

### 3. Reuse service artwork through the Web icon boundary

Use the Google and Apple artwork already selected by `GoogleLoginButton.vue` and `AppleLoginButton.vue` (`logos:google-icon`, `logos:apple`) from the pinned Iconify package. Use an envelope from the installed Solar set for email. Curate only these assets into application-owned SVG sources, recording upstream collection/version and license information with their provenance. No new package or network-loaded image is needed.

Use `AppIcon` and semantic `account.sign-in.*` registry keys. Google is fixed-color brand artwork. Use Apple's explicitly supplied monochrome artwork with the Web text color so it remains visible across themes, and use current-color email geometry. Record rendering kind, viewBox/intrinsic dimensions, size, paint policy, and decorative accessibility in `registry.json`. Generate `registry.generated.ts` with `pnpm icons:write` and check it with `pnpm icons:check`; do not hand-edit generated output or change existing entries' provenance to accommodate this addition.

### 4. Keep responsive handling local

The text column uses `minmax(0, 1fr)` and wraps long addresses. Keep the method icon, text stack, and action in three columns at the 320px supported narrow width instead of forcing actions onto a separate row. At 540px and below, use a 24px icon slot, 10px column gaps, and 13px auxiliary action type with 10px horizontal padding while preserving the 44px target. Keep the 20px artwork itself unchanged. From 360px through 540px, indent the form by the 34px icon/text offset; below 360px use the full card interior to preserve editing space. Above 540px retain the existing 44px text-column indent. Verify 320/360/375/390/540/768px and desktop, including long addresses and both locales. These are local component measurements, not a new application breakpoint policy.

### 5. Preserve the reviewed rollout and state machine

Use the existing profile value to allow development and preview in both Web visibility conditions; beta and production remain hidden. This implements the requester's clarified test-profile policy without adding a flag or a new shared configuration abstraction. Do not infer a verified login mailbox from a profile email or the independent mail-collection binding. Keep provider configuration and callback-origin rules, binding endpoints, stale-account checks, cancellation, success announcements, and email-row focus restoration intact. This is a presentation change, not an opportunity to alter authentication behavior.

### 6. Compact account-binding form after hands-on feedback

The requester asked to refine the expanded form on 2026-11-12. Keep its existing maximum width and method-text alignment. Use the existing `purpose="bind"` boundary to select a local inline presentation: a flexible input beside an intrinsic-width send/verify button in both stages, including the 320px viewport. Keep a visible 13px muted field label above the input, with a 44px-or-taller input and action aligned at the bottom. Use an 8px control gap; the email input scrolls its value internally instead of forcing a page overflow.

Reserve a stable minimum action width (104px above 540px, 96px at narrower widths) so stage/busy labels do not shift the field unnecessarily. At touch widths, use `--slax-fs-body` for input values and keep the visible labels at the auxiliary size. When email is expanded, keep Cancel in its existing trailing action position but use a transparent, muted treatment with visible focus and a 44px target; it must not compete with the form's stage action.

The stage's send/verify control uses `--slax-accent` with `--slax-btn-text`; focus, disabled, and error roles continue to use Web tokens. Sent-to, expiry, and error messages span the form width, and change-address/resend actions remain below. A controls wrapper preserves the base form's source-order behavior. Account binding selects the compact variant through its existing purpose; the reviewed login extension explicitly selects the same compact presentation at its consumer, with the narrower action sizing described below. Do not add a general layout framework, change verification stages, or alter binding requests.

### 7. Proposed login-module presentation after account acceptance

The requester reviewed and authorized this extension on 2026-11-12. Reuse the existing envelope artwork in a 44px provider-style email entry. Keep one `EmailLoginForm` group so both hosts receive the same treatment without changing each host's provider order. In the expanded state, retain the icon and current localized email action text as an identity heading, place quiet Cancel at its trailing edge, and render the compact verification form beneath it. No extra nested card, divider section, or decorative background is proposed.

Select compact presentation deliberately at the login consumer, retaining the existing authentication-purpose contract. The account variant remains unchanged. Give login submit controls a 96px minimum width in both desktop and mobile contexts: the modal's 320px viewport leaves approximately 230px of interior space, so the remaining input width is about 126px after the 8px gap. Continue 16px input values at touch widths, visible auxiliary labels, semantic accent submit colors, full-width feedback, and the existing change-address/resend behavior.

Keep the existing cancellation operation and provider-switch capture handlers, request ownership checks, referral/acquisition attribution, and return target. Prefer retaining the same toggle button DOM identity through open/close so cancellation focus has a clear destination. Verify both host surfaces, short scrollable modal viewports, two locales, three themes, and the supported phone/desktop widths; then re-exercise the accepted account subsection to guard the shared form boundary.

## Risks / Trade-offs

- More vertical breathing room increases subsection height. The existing card can expand; the gain is readable grouping and unclipped controls.
- Brand and monochrome artwork have different optical bounds. Inspect their 20px rendering in all three themes instead of assuming equal view boxes imply equal visual weight.
- Long translated actions can require a second line. Permit local wrapping and verify English and Chinese with long-address fixtures.
- A screenshot of development cannot demonstrate profile coverage. Exercise preview as visible, and beta/production as hidden, separately with bound and unbound accounts.

## Verification and Delivery

Run focused component/page tests for existing linking semantics and the #577 visibility regressions, Web type checking, targeted lint, icon checks, and strict OpenSpec validation. Use the application running against a local fixture API to compare baseline and revised account cards at 1280px/light, 768px/dark, and 320px/e-ink, then exercise all three themes at each width and check the 540px component transition.

Cover bound and unbound email, configured linked/unlinked providers, expanded form, invalid-code and provider errors, busy/disabled controls, unavailable provider linking, long addresses, both locales, keyboard focus, and successful binding. Capture matched before/after evidence outside Git and record commands, observed results, limitations, and the requester's hands-on acceptance in `validation.md` before a PR opens. No production credential or live-mail access is required for the local fixture exercise.

No data migration is needed. Reverting the component/assets change restores the earlier presentation without changing stored identities.
