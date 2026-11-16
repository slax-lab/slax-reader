# Web sign-in methods presentation verification

## Scope and baseline

- Change: `polish-web-sign-in-methods`; task branch `fix/polish-web-sign-in-methods`.
- Baseline: `c1e5aa84c9a775a31f93817fb6e14d9a77937ed6` (`origin/dev`, including merged #577).
- Proposal reviewed and implementation authorized by the requester in conversation on 2026-11-12. The branch was newly created from that baseline for this task; the unrelated original workspace was left intact.
- Implementation changes the Web account sign-in methods presentation, shared `Login/EmailCodeForm.vue` presentation, `Login/EmailLoginForm.vue`, three curated SVG sources, their attribution notice, registry manifest, and generator-produced output. The login consumer now deliberately selects compact presentation; the accepted account variant remains intact. The final correction also allows both development and preview in the two existing Web visibility predicates. Authentication requests, backend APIs, environment configuration, shared contracts, Mobile, and Extension are unchanged.

## Earlier implementation evidence

The sections below record the successive development-only UI iterations. Their rollout, acceptance, and suite-count statements are historical; the final delivery section supersedes them.

### Automated checks

- Installed the Web/root dependency closure with `pnpm install --frozen-lockfile --filter @apps/slax-reader-dweb... --filter slax-reader`. The lockfile did not change.
- The first baseline test invocation stopped before running tests because the new worktree lacked `.nuxt/tsconfig.app.json`. The documented Nuxt prepare command generated it, then all four baseline suites passed (61 tests).
- After implementation, `pnpm web -- test tests/unit/components/UserSignInMethodsSection.spec.ts tests/unit/pages/user.spec.ts tests/unit/components/Modal/LoginModal.spec.ts tests/unit/components/global/LoginView.spec.ts tests/unit/components/AppIcon.spec.ts --maxWorkers=2` passed all 72 tests in five suites. Existing tests cover account-scoped binding, stale-account rejection, focus restoration, provider linking, and the development/preview/beta/production rollout, including already-linked identities.
- `pnpm web -- typecheck` exited 0.
- `pnpm --filter @apps/slax-reader-dweb exec eslint app/components/UserSignInMethodsSection.vue` exited 0 with no lint findings.
- `pnpm icons:write` generated the output from curated sources; `pnpm icons:check` passed for 59 entries. `pnpm icons:test` passed all 17 tests, including SVG active-content validation and generated-registry freshness.
- `openspec validate --all --strict` passed all 135 items. Informational messages in unrelated existing specs are not validation failures.
- `git diff --check` passed. The full Web suite and a production build were not run for this component/assets-only change; the five focused suites, type check, generator checks, and live Vite rendering are the automated/build-boundary evidence.
- Commands used explicit synthetic public configuration through a temporary shell wrapper. No secret files were read or copied. Nuxt's absent Turnstile/local-site URL warnings and the test runner's existing SSR/OG warning appeared with those fixture values.

## Running Web application

Chromium exercised the actual Nuxt application at `http://localhost:3287/user` against a separate loopback API fixture at port 8894, with a synthetic account and mailbox. Production components, styles, registry, page routing, and binding requests ran in the browser; the fixture captured mail requests and never contacted Resend or OAuth providers.

### Development presentation and interactions

- Checked the cross product of 1280px, 768px, 540px, and 320px with light, dark, and e-ink (12 combinations). Browser measurements confirmed no horizontal page overflow, 16px subsection heading, 14px/500 method names, 13px subordinate status, 12px top/bottom group padding, and actions at least 44px high.
- All three artwork assets loaded at their intended 20px width. The Google artwork retained its fixed colors; Apple and email followed the theme's text color. Artwork was hidden from the accessibility tree, with the existing visible translated method names retained.
- Keyboard navigation exposed the 2px focus-visible outline. Expanding email focused its address input, with the form inside the email method group before the next separator.
- Sending a code displayed the busy/disabled state and disabled resend during cooldown. An invalid code displayed the existing localized error. Retrying with fixture code `012345` completed binding, closed the form, updated the status, announced success, and restored focus to the email row. The existing Google binding remained present.
- A simulated provider ownership conflict displayed the existing provider error. Real authorization was not attempted.
- Bound mailboxes with a deliberately long address wrapped at 320px in all three themes. The account page's real language selector was used to verify Chinese as well as English; labels, status, and actions remained readable.
- No uncaught browser page errors occurred during the completed development matrix. The fixture does not implement live PowerSync or real token refresh; the existing application emitted corresponding synchronization/refresh console warnings. Those integrations are outside this presentation change and were not claimed as verified.

### Rollout and unavailable-provider checks

Separate Nuxt processes were started with `SLAX_ENV=preview`, `beta`, and `production`. Each was checked with both unbound and already-bound accounts at 1280px/light, 768px/dark, and 320px/e-ink (18 account cases total). All omitted the entire subsection. Anonymous login in each process retained the existing Google/Apple controls and omitted the email entry. These results agree with the mounted regression suites. The processes were stopped after each check; the development preview was then restored.

With the development server bound to loopback-accessible interfaces, Chromium opened the account page through `127.0.0.1` while its configured OAuth callback retained `localhost`. The existing origin rule hid provider actions, retained the single email-binding action, and displayed the explanatory unavailable note with all three method rows intact at 320px. This used a reset unbound fixture account. The first attempt encountered an IPv6-only development listener, and a later harness assertion inherited the preceding bound fixture state; listener/state setup was corrected without a product change.

## Visual evidence

Matched baseline and revised account-card screenshots were captured at 1280px/light, 768px/dark, and 320px/e-ink, using the same account state, viewport, and theme. The baseline was served before editing the component from `c1e5aa84`. Screenshots, local fixture scripts, and browser measurement JSON are outside Git under `/tmp/slax-signin-evidence/`; only this standalone text record is tracked. Expanded-error and long-mailbox screenshots are included in that local evidence set.

## Review and acceptance

A separate read-only reviewer inspected the entire implementation and new sources against `REVIEW.md`, `DESIGN.md`, the proposal/design/specs, and browser evidence. The Bugs, Security, and Compliance passes found no Important or Nit findings. Icon attribution, provenance, decorative accessibility, theme behavior, narrow layout, expanded grouping, and preserved authentication/rollout code were included in the review.

On 2026-11-12, after exercising the prepared `/user` preview and requesting the documented form and phone-layout refinements, the requester stated they were generally satisfied with the Sign-in methods subsection and moved on to email login. This records requester hands-on acceptance of the account subsection. The requested email-login extension was subsequently reviewed and authorized; its implemented preview required separate hands-on acceptance at that stage, subsequently recorded in the final delivery section.

No CLI, Extension, or Mobile logic, assets, runtime dependency, contract, native integration, or package output changed, so their version-decision checkpoint is not applicable.


## Hands-on form and small-screen follow-up (2026-11-12)

The requester preliminarily found the method list improved, then asked to redesign the expanded email form and requested a dedicated subagent analysis of visual refinement and small-screen behavior. This is feedback on the implemented preview, not final acceptance.

### Changes from that feedback

- The account-binding variant now keeps the address input and Send action side by side, and the code input and Verify action side by side. Field labels remain visible, sent-to feedback spans the form, and errors/expiry notes occupy separate full-width rows. At that account-only stage, the existing `purpose=bind` boundary scoped compact presentation while anonymous login remained stacked. The later reviewed login extension below intentionally opts the login consumer into compact presentation.
- A dedicated design subagent identified the old <=540px forced action line break as the main small-screen density problem. Method rows now retain three columns at phone widths, with a 24px icon slot, 10px gaps, auxiliary-size row actions, and at least 44px targets. Cancel uses a muted, transparent treatment, including a transparent hover border.
- The form aligns with the method text at 360–540px using a 34px offset, retains the desktop 44px offset, and uses the full card interior below 360px. Binding inputs use the Web body size (16px) at touch widths. Send/Verify actions reserve 104px minimum width on larger screens and 96px on phones, reducing label-driven width shifts.
- All color/font roles are existing Web semantic tokens. No new decorative panels, gradients, global theme rules, dependencies, or authentication behavior were added.

### Fresh verification after the refinement

- The four account/page/login regression suites passed all 61 tests. Web type checking and targeted ESLint for both touched Vue components exited 0. Strict OpenSpec validation passed all 135 items; whitespace checks passed.
- Chromium measured both address and code stages in English and Chinese at 1280/768/540/390/375/360/320px, in light/dark/e-ink: 84 layout cases. All had same-row input/actions, aligned control bottoms, targets at least 44px high, and no horizontal page overflow. The minimum measured input width was about 141px. Method action centers remained aligned with their name/status stacks instead of dropping to another row.
- Keyboard submission, send busy/disabled feedback, code focus, invalid-code full-width error, change-address focus restoration, retry, successful binding, and final email-row focus all passed. A separate short-lived challenge verified simultaneous expiry and error messages without overlap, with Verify disabled. A separate anonymous context confirmed that the then-unmodified login consumer retained its original stacked controls. This is historical account-boundary evidence, superseded for login presentation by the reviewed extension below.
- Previously verified preview/beta/production rollout gates were not changed by this follow-up; their existing mounted regressions passed again. No additional live-mail, provider, synchronization, or native Safari session was run.
- Final screenshots replace the intermediate form captures: `final-form-1280-light.png`, `final-form-390-light.png`, `final-form-375-light.png`, `final-form-360-light.png`, `final-form-320-light.png`, and `final-code-zh-320-dark.png` under `/tmp/slax-signin-evidence/`. The final pointer is outside controls so captures do not accidentally represent hover as the resting Cancel treatment.
- Independent follow-up review of Bugs/Security/Compliance found no Important or Nit findings. Requester hands-on acceptance was pending at this stage and was subsequently obtained as recorded below.


## Email login scope requested after account acceptance

The requester asked for a dedicated subagent analysis of email login. That analysis inspected the real anonymous login page and both consumers of the shared module, identified the iconless entry/full-width Cancel and stacked controls as the hierarchy/density problems, and proposed a constrained module refinement. The requester reviewed the concrete description and explicitly authorized direct implementation on 2026-11-12. The login extension is now implemented and verified as recorded below.

Baseline anonymous screenshots were captured at 1280/360/320px under `/tmp/slax-signin-evidence/login-before-*.png`. The current account implementation remains intact. The offered optional demo and the login proposal review are tracked in conversation; pending input is not treated as approval.


## Email login implementation verification (2026-11-12)

### Implementation

- The collapsed email entry reuses the curated decorative envelope with the existing 44px provider-button treatment. Expanded email retains its identity label and places a quiet Cancel at the right. The same toggle DOM remains mounted so cancellation retains a clear focus destination; its `aria-controls` matches the expanded form ID.
- The login consumer explicitly enables the compact shared form and a scoped 96px submit minimum. Both address/send and code/verify stay on the same row. Existing labels, supporting status, errors, expiry, resend, change-address, and touch input sizing remain available.
- `LoginView.vue`, `LoginModal.vue`, provider components, auth logic, API contracts, and rollout conditions were not edited for this extension. The page retains email/Google/Apple order, and the modal retains Google/Apple/email order. The accepted account form's rendering selector and dimensions were not changed.

### Fresh automated evidence

- The five focused account/page/login/icon suites passed all 72 tests, including non-development email visibility, provider configuration, invitation/Turnstile gating, request cancellation, referral/acquisition context, and continuation regressions.
- Web type checking and targeted ESLint for `EmailLoginForm.vue` and `EmailCodeForm.vue` exited 0. Strict OpenSpec validation passed all 135 items. `git diff --check` passed.
- As before, the full Web suite and production build were not run; focused regressions, type checking, and the actual Nuxt/Vite runtime are the verification boundary for this local presentation extension.

### Running browser evidence

- Chromium measured address and code rows for both standalone login and the actual `showLoginModal` bootloader in English/Chinese at 1280/768/540/390/375/360/320px and light/dark/e-ink: 168 cases. All retained side-by-side controls without horizontal overflow; the minimum measured input width was about 125px and controls remained at least 44px high.
- Decorative entry/heading icons, persistent identity, form-ID association, visible labels, the original host-specific provider order, initial input/code focus, busy/disabled send, invalid-code error, change-address focus, cancellation focus, and reopening all passed.
- All four host/locale combinations completed keyboard-based code login through the actual Web request/session-cookie path against the fixture API, then returned to `/user?from=email-ui#account`. Captured fixture requests retained login purpose and locale, and the standalone referral code. No real mailbox or provider was contacted.
- At 320x568, the real modal's existing card scroll container kept resend, submit, legal, and close controls reachable; closing removed the modal and restored scrolling. A separate short challenge displayed invalid-code and expiry feedback together, with Verify disabled and supporting actions still reachable. In-flight verification was aborted by both Cancel and switching to Google; the late fixture token was not persisted. The Google navigation was intercepted locally, so this did not contact a real OAuth provider.
- A fresh 320px account smoke confirmed that the accepted binding form has no login-only modifier; address/code rows, successful binding, success announcement, and focus restoration still passed after the login extension.
- No uncaught browser page errors occurred in the completed matrix. The fixture is not a live PowerSync/backend integration environment, so the existing synchronization warnings are not evidence of production authentication or synchronization.

### Review and visuals

Independent Bugs/Security/Compliance review found no Important or Nit findings in the full branch and latest login extension. It checked the shared-form boundary, persistent cancellation control, accessibility association, provider order, lifecycle preservation, and scoped styling.

Matched login baselines are `login-before-*.png`; revised standalone/modal collapsed, address, and code images are `login-final-*.png`, including the 320x568 short-modal captures, all outside Git in `/tmp/slax-signin-evidence/`. Scripts and measurement JSON remain there as local artifacts; this text record stands on its own.

The account subsection's requester acceptance remains recorded above. Hands-on acceptance was pending at this stage; the final acceptance and delivery evidence follows.


## Final preview correction and delivery evidence (2026-11-12)

### Accepted scope and integration

- The requester accepted the account subsection after the compact-form and small-screen iterations, then exercised the revised login preview and accepted it as sufficient for this iteration. Both hands-on acceptances were provided in conversation on 2026-11-12, before PR creation. Their final instruction clarified that test environments include preview and authorized one combined email-optimization PR.
- The task branch was rebased cleanly onto latest `origin/dev` at `69c56d58`; no conflicts or unrelated changes were introduced. The screenshot baseline remains `c1e5aa84`, where the original email UI was captured.
- The existing predicates in `EmailLoginForm.vue` and `UserSignInMethodsSection.vue` now allow `development` and `preview`. Beta/production omit email login and the entire account methods subsection, including bound identities. No backend or native Mobile rollout changed.
- The sole `email-authentication` delta remains in merged/unarchived `add-email-otp-auth`; its proposal, design, rollout scenario, and task wording were reconciled with this clarified Web policy. No second delta for that capability was created. Archive the original authentication change before or together with this presentation change after merge.

### Final automated checks

- Regression-first reproduction: adding preview to the existing complete binding/login cases and updating visibility expectations produced four failures across the three affected component suites before changing the two predicates.
- `/tmp/slax-signin-run.sh pnpm web -- test --maxWorkers=3`: **234 files passed, 1 skipped; 2,823 tests passed, 3 skipped**, exit 0. This includes the complete development/preview account-binding, standalone referral/acquisition login, modal collection continuation, and beta/production hidden-state cases. Happy DOM emitted fetch-abort diagnostics during teardown without failing the run.
- Web type checking and targeted ESLint for all three touched Vue components and three changed test files exited 0.
- `pnpm icons:check`: 59 entries valid. `pnpm icons:test`: all 17 tests passed. The registry output was generated through `pnpm icons:write`.
- `pnpm exec openspec validate --all --strict`: all **137** items passed after integrating latest dev. `git diff --check` passed.
- No production build was run: the verification boundary is the full Web suite, type/lint/icon validation, and actual Nuxt runtime. The change does not affect CLI, Extension, or Mobile package output, so their version-decision checkpoint does not apply.

### Final running-profile checks

Each profile used an independent actual Nuxt process, public synthetic configuration, production components, and the loopback fixture API. The final runner was `/tmp/slax-signin-evidence/pr-profile-matrix.py`.

- **Preview:** repeated all 168 address/code layout measurements across standalone and modal hosts, two locales, seven widths, and light/dark/e-ink, plus the four keyboard/error/cancel/session/return-target flows and 320x568 modal scrolling/dismissal. All passed. A fresh unbound account at 320px completed send/verify/bind, success announcement, and focus restoration; a bound account retained its mailbox/provider status at 320px.
- **Beta and production:** each process checked bound/unbound accounts at 1280px/light, 768px/dark, and 320px/e-ink (12 account cases total), plus anonymous login. The whole account subsection and email login were absent; Google/Apple login remained available. All passed.
- **Development:** the earlier 84 account and 168 login layout/interaction matrices above passed. After the final profile run, restored development and recaptured the matched account, standalone login, and short-modal after images against the original development baselines.
- Logs and measurement JSON live outside Git under `/tmp/slax-signin-evidence/pr-*-browser.log` and `pr-preview-ui-browser-results.json`; fixture traffic never delivered real email or completed OAuth. Hosted deployments, real provider authorization, native Safari, and live PowerSync/backend integration remain unverified because this exercise uses local synthetic accounts and responses.

### Final local review and visuals

The independent reviewer repeated all three `REVIEW.md` passes after the preview correction and latest-dev rebase. No Important Bugs or Security findings were found. One Compliance Nit grouped two stale planning phrases; both were corrected to distinguish Web development/preview from native Mobile development-only rollout. The full-suite and final profile evidence above subsequently completed the verification trail. Final independent recheck of the completed evidence and artifacts found no remaining Important or Nit findings.

The PR includes matched development-profile before/after images for the unbound account card (1280px/light), expanded standalone email login (320px/light), and focused expanded login modal (320x568/light). Captures and test harnesses remain outside Git; only this self-contained evidence record is tracked.
