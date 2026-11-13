# Design

## Context

See `proposal.md` for scope and the reconciled predecessor deltas for ordering and rollout contracts. PR #584 is merged into the task's latest-dev baseline. The standalone login currently renders email first, the modal already renders it last, and `/user` renders email before its provider rows. Both Web visibility predicates allow development and preview only.

`EmailCodeForm.vue` clears `pending` unconditionally when its verification callback settles. `EmailLoginForm.vue` awaits session persistence and `navigateTo(..., { external: true })`. Inspection of the installed Nuxt implementation shows that external navigation assigns `location.href` and returns an already-resolved promise outside middleware; it does not await the browser leaving. Consequently the old form can become actionable during departure. A regression test must reproduce this using a resolved navigation-start operation before any fix.

## Goals / Non-Goals

**Goals:** Preserve the already accepted compact form, explicit input labels, account-safe binding, host-specific referral/collection context, and cancellation before success. Make the provider preference clear through order and entry hierarchy without hiding email behind another menu.

**Non-Goals:** Redesigning the page/modal shell; changing OTP timing, authentication endpoints, account ownership, destination validation; adding provider-specific recommendation copy, credentials, dependencies, or a preference synchronization service.

## Decisions

### 1. Change source order and entry hierarchy locally

Use DOM order Google, Apple when configured, then email in both login hosts and the account subsection. This keeps keyboard and screen-reader order consistent with visual order instead of applying CSS ordering. Retain provider artwork and the current provider-button treatment. The collapsed email entry becomes a transparent, borderless quiet text-and-envelope control using existing muted/text/hover/focus roles and a 44px target; expanded Cancel retains its quiet treatment. In `/user`, keep the readable email name/status and lower only the email-link action's visual emphasis. Once email is chosen, Send/Verify stays the clear stage action. Do not dim an entire interactive module with opacity or add a new decorative separator/card.

### 2. Remember a successful login address at the login boundary

Add a small Web-owned local-preference utility for one origin-scoped storage key. Read once when an anonymous form opens, validate the stored value at that storage boundary, and pass the value as an initial address into the shared form. Keep binding's initial address empty. Save the trimmed submitted address after `verifyEmailAuth` successfully persists the session and the existing abort check passes, before starting whole-page navigation. Do not write while typing or on Send; that would replace a proven address with an unfinished attempt.

Read/write the browser preference only on the client. Handle expected storage access failures at this boundary without logging the address or blocking authentication. Reuse the project's existing email constraints for a valid bounded stored address. Keep the preference across normal logout because it is intentionally useful on the next login; do not store codes/session secrets or send the preference to analytics. A server cookie, user-store field, cross-origin transfer, and address history are unnecessary for a single local last-used value.

### 3. Retain successful login state until departure

Give the shared form a login-selected terminal-success policy; binding keeps its current completion behavior. Verification remains locked while pending, and a successful login callback leaves it locked when external navigation returns before document departure. Apply the same lock to code input, resend, change-address, and submit guards; a CSS-disabled button alone would not block keyboard/direct submissions. Keep the existing busy label rather than inventing a timed success screen.

Clear ordinary pending state on verification errors, preserving invalid-code retry, cancellation/abort, and expiry semantics. Once success is committed and departure starts, ordinary `stop()`/Cancel must not clear the terminal lock or let the same login module close/reopen a fresh form; disable the local cancellation toggle for that interval. Component unmount still performs normal cleanup. Retain the existing explicit navigation-failure error path. Do not add a delay, timer, global login lock, backend retry, or an unresolved promise to simulate browser departure. Regression tests will hold the old mounted form after a resolved navigation start, then attempt click/Enter/direct submit and cancellation/reopening and assert one verification request.

### 4. Remove client environment restrictions (amended 2026-11-13)

Remove Web email-login and account-subsection profile predicates rather than expanding an allowlist. On Mobile remove `config.development` from login availability and remove the development option/check from account presentation and `useLinkedPlatforms.openEmail`. Retain `!fixtureOnly`, fixture transport isolation, platform-list readiness, current-account ownership, existing-mailbox and mutation guards. Email authentication and binding are available in every real Web/iOS/Android environment, including production. Extension login through Web uses the same unrestricted surface. Provider configuration, callback-origin rules, credentials, and API authorization remain unchanged. The requester's explicit all-environment decision supersedes the earlier Web-only beta rollout. On Mobile, `emailEnabled` also selects the login content container: normal non-development clients now use the existing email-enabled `ScrollView` with `scrollContent`/`scrollTop` flex-growth styles instead of the fixed content `View`. This is a container/scroll behavior expansion as well as entry availability; no new control styling or provider order is introduced. Fixture-only clients retain the original non-email container.

### 5. Keep predecessor delta ownership explicit

The main spec inventory has no archived email/presentation capabilities yet. Keep `email-authentication` solely in `add-email-otp-auth`, and both Web presentation capabilities solely in `polish-web-sign-in-methods`, updating those planning artifacts for this sequenced follow-up. The new delta covers only remembered-login/departure behavior. Original verification and acceptance records remain historical; current follow-up tasks and fresh acceptance belong to this change. Archive the reconciled changes together after implementation merges.

## Risks / Trade-offs

- A shared browser displays its last authenticated email when email login opens → this is the explicitly requested local convenience; keep it editable, store only one address, and avoid server/cross-origin synchronization.
- Authenticated navigation initiation can finish before document departure → terminal form state persists without a timeout; wrong-code errors still permit retry.
- A quieter entry could become hard to discover → preserve its explicit label, envelope, contrast, focus ring, and 44px target. Check English/Chinese and light/dark/e-ink at 320px, 768px, and desktop, plus the 320x568 modal.
- Local fixtures cannot prove hosted credentials or email delivery → verify actual production-profile client behavior locally and declare hosted mail delivery separately in the evidence.

## Migration and Verification

There is no account or API migration. A new local preference key is additive; reverting the UI ignores it without changing account identities. Verify the default/remembered/edited address states, failed and cancelled attempts, successful replacement, storage failure, binding isolation, pre-success aborts, delayed departure, and return targets in the existing test suites and running fixture-backed Nuxt app. Run Web type/lint, icon checks if applicable, and strict OpenSpec validation. Record fresh human hands-on acceptance before opening a task PR; The completed Web-only phase did not require a native package version decision; the subsequently approved App extension below does require a Mobile version decision before handoff as ready.


## Approved App Presentation Extension

After accepting Web, the change requester reviewed and authorized this narrow addition on 2026-11-12. `LoginScreen` already renders Google, iOS-only Apple, then email; keep that source order. Add only an email-specific borderless button treatment and regular-weight `C.secondaryText`, preserving the existing 50-point target, width, pressed overlay, agreement gating, analytics identifiers, busy guards, and fixture-only isolation (the original development predicate is superseded by decision 4). Do not use `C.mutedText` to make an interactive label faint, change provider buttons, add Web tokens, or change authentication.

In `AccountSignInMethods`, move the complete mailbox status/bind group after Google and Apple state/actions (including the existing Android Apple-link guidance). Keep the existing `SourceButton` implementation and its native pressed/disabled behavior, using a local borderless style and Mobile metadata/secondary-text role for the email-link action. Preserve bound mailbox readability, dialog placement, and all controller callbacks.

The existing `email-authentication` delta remains the single owner for native provider-first presentation; add its native ordering/hierarchy scenarios there, without another capability delta. Extend the existing mounted login/settings suites for platform-dependent source order, all-environment availability, quiet control styling, touch size, and existing agreement/binding behavior. Run Mobile check and both-platform bundle validation. Native runtime evidence must use isolated fixture accounts and app identities; no production accounts, signing, upload, or publication are authorized by this extension. Web acceptance is already recorded; App requires its own hands-on review before combined PR delivery. Obtain the Mobile version decision after the native changes are prepared and validated, as required by `docs/release/VERSIONING.md`.
