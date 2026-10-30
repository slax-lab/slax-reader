# Validation

## Scope and review

- Date: 2026-10-30 (Asia/Shanghai).
- Change: `login-modal-benefits`; branch: `feat/login-modal-benefits`.
- The requesting user approved the proposal in conversation before implementation.
- Product changes are limited to LoginModal presentation and its English/Simplified Chinese messages. The new list uses existing semantic theme tokens. The card now scrolls internally when its content exceeds the available viewport height.
- No authentication, redirect, provider configuration, API, dependency, or other application code changed. CLI, Extension, and Mobile version decisions are not applicable.

## Initial implementation: automated checks

All commands ran in this worktree with documented placeholder Web public configuration, without reading or copying secret files.

| Check | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | Passed; no lockfile changes |
| `pnpm web -- typecheck` | Passed |
| `pnpm web -- test tests/unit/components/Modal/LoginModal.spec.ts` | Passed: 1 file, 8 tests, including Google redirect and configured/unconfigured Apple visibility |
| `pnpm --filter @apps/slax-reader-dweb exec eslint app/components/Modal/LoginModal.vue` | Passed |
| `pnpm web -- build` | Passed, including the final card overflow styles |
| `pnpm exec openspec validate --all --strict` | Passed: 88 items, 0 failures |
| `git diff --check` | Passed |

The full Web unit suite was not run for this localized presentation change; the existing affected-component suite was selected. Builds reported the expected placeholder localhost/site-config and absent Turnstile-key warnings.

## Initial implementation: running-environment exercise

The agent's terminal could not listen on 127.0.0.1:3217 (EPERM), and browser policy rejected a file URL. The user then started the prepared Nuxt dev command in their own terminal. All browser evidence below comes from that real Nuxt environment at `http://localhost:3217/login/preview`, not the unused offline bundle.

The temporary Nuxt layer at `/private/tmp/slax-login-modal-evidence` adds a preview-only page. It mounts the actual worktree LoginModal, actual GoogleLoginButton and AppleLoginButton, and the actual modal bootloader, VueUse scroll lock, localization, global styles, and theme tokens. It does not modify tracked routes or shipped configuration. Placeholder OAuth client IDs show both provider controls; no provider login is completed.

Exercises:

- Opened the modal using a page button. Confirmed the three exact Simplified Chinese statements appear in the requested order between the original subtitle and provider controls.
- Confirmed all three checkmark spans are `aria-hidden="true"`; visible provider and legal-link text remains unchanged.
- Verified the light, dark, and e-ink themes at widths 1280, 768, and 320px, each at 720px height: all nine combinations have no horizontal card overflow; the panel stays within the card; the card stays within the viewport.
- Confirmed the panel follows light/dark semantic accent backgrounds and e-ink uses a neutral gray panel with black text. E-ink suppresses the overlay blur as required by existing global styles.
- Switched to English and checked 320x480: the card is 432px high with 24px top/bottom insets and 606px scrollable content. No horizontal overflow; close control remains visible at the top.
- Scrolled the English card by 176px. Both 44px-high provider buttons and the legal links were visible and reachable inside the viewport.
- Closed via the close button and separately by clicking the overlay. Both remove the modal; document overflow returns from `hidden` to its original empty value.
- Opened the final Chinese modal in a fresh browser tab. Its browser error log was empty. A prior temporary-preview hot-reload transition error did not reproduce after a clean load.

## Initial implementation: visual evidence

Screenshots are stored outside git. Before/after use the same anonymous Chinese state, light theme, 1280x720 viewport, and both provider buttons. The before image renders the original LoginModal source copied from this branch's unchanged baseline before editing; the after image renders the worktree implementation.

Persistent local artifacts:

- Before: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/before.jpg`
- After: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/after.jpg`
- Mobile: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/mobile.jpg`
- Dark: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/dark.jpg`

Additional theme/width images, short-English scroll evidence, command logs, and geometry measurements are under `/private/tmp/slax-login-modal-evidence`.

## Verification limits and acceptance

- Real OAuth completion and post-login navigation were not exercised: the preview uses placeholder client IDs and no backend integration environment. Existing redirect/provider logic is unchanged and covered by the affected regression tests where available.
- Public article backend entry points were not exercised; the temporary page invokes the same modal bootloader directly to isolate the requested UI.
- The existing fixed-black Apple brand icon is unchanged and remains low contrast on the dark button surface; this task verifies the added panel, not a provider-logo redesign.
- Human hands-on acceptance is complete. On 2026-10-30 (Asia/Shanghai), the requesting user reviewed the final running preview and confirmed it was satisfactory, explicitly authorizing the PR and inclusion of the latest screenshots. Their preceding design-conformance feedback was implemented and re-verified; no additional changes were requested at acceptance.
- A successful pre-push `git fetch origin dev` on 2026-10-30 confirmed origin/dev at a9954483, identical to the branch base; no integration changes or rebase were needed.

## Local review

Reviewed the product diff and linked artifacts using REVIEW.md's three passes:

- Bugs: no Important findings; provider handlers and redirects are untouched, locale keys match, the list wraps naturally, and short-screen content scrolls inside the card.
- Security: no Important findings; no new dependencies, network calls, external markup, or credential access.
- Compliance: implementation matches the approved narrow scope; automated and browser evidence is recorded. Human hands-on acceptance is recorded below. Pre-push review is recorded in the delivery section; archive-after-merge remains pending. No merge/archive is claimed.

## Design conformance follow-up (2026-10-30)

The requesting user explicitly authorized an audit and corrections against the current DESIGN.md. The new benefits panel was already compliant. The surrounding modal had legacy typography literals, low-contrast legal text, no component focus-visible treatment, and no reduced-motion handling. Corrections use the semantic type scale, muted text, modal shadow, blur/easing tokens, safe-area-aware insets, localized close label, and visible focus outlines. Provider logic and fixed brand artwork remain unchanged; DESIGN.md section 6 requires preserving approved fixed brand paint.

Fresh automated checks all passed after these corrections:

- `pnpm web -- typecheck`
- `pnpm web -- test tests/unit/components/Modal/LoginModal.spec.ts`: 8 tests passed
- `pnpm --filter @apps/slax-reader-dweb exec eslint app/components/Modal/LoginModal.vue`
- `pnpm web -- build`: completed successfully
- `pnpm exec openspec validate --all --strict`: 88 passed, 0 failed
- `git diff --check`

The initial sandboxed typecheck/test attempts could not write temporary build files in this managed worktree. They were rerun with the approved worktree write permission and passed. The preview briefly reloaded while the shared Nuxt generated output rebuilt; the following observations were collected after it recovered.

Fresh running-browser observations on the actual component:

- All nine combinations of 1280/768/320px width and light/dark/e-ink at 720px height fit horizontally with readable wrapping. Desktop/768 title size is 32px; compact title is 22px; legal text is 12px.
- Legal text contrast against the card, calculated from the actual theme RGB values, increased from 3.11:1 to 6.04:1 in light mode and from 2.75:1 to 5.35:1 in dark mode; e-ink is 12.63:1.
- Keyboard navigation reached the localized close button, Google, Apple, Terms, and Privacy controls. All five displayed a 2px solid accent outline with a 3px offset and matched `:focus-visible`.
- E-ink computed styles confirm no shadow, no backdrop blur, and zero transition duration. Light/dark use the correct modal shadow and blur tokens.
- English at 320x480 had a 432px-tall card inside 24px top/bottom insets, 607px scrollable content, and no horizontal overflow. Keyboard navigation scrolled the card by 176.5px to expose both 44px provider buttons and the legal links, while the close button remained visible.
- Closing the modal removed it and restored document overflow from hidden to its original empty value.
- The browser-loaded compiled CSS contains the scoped prefers-reduced-motion rule disabling modal/control transitions and entrance/press transforms. The connected browser does not expose media-preference emulation, so an actual OS reduced-motion toggle was not exercised. Nonzero hardware safe-area insets were not available on this desktop browser; viewport sizing and the compiled env-based inset calculation were checked. These are explicit agent-verification gaps, not claims of device testing.

Updated screenshots supersede the initial after images and are stored outside git:

- Desktop light: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/design-audit.jpg`
- Desktop dark: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/design-audit-dark.jpg`
- Desktop e-ink: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/design-audit-eink.jpg`
- Mobile light: `/Users/yjc/.codex/visualizations/2026/10/30/01a18b78-00ee-7393-a220-8a9eb4bb9d07/login-modal/design-audit-mobile.jpg`

Measurements, keyboard-focus results, the short-English screenshot, and fresh command logs use the `audit-` prefix under `/private/tmp/slax-login-modal-evidence`. The original matched before screenshot remains valid.

Local REVIEW.md passes were repeated against the final diff: no Important Bugs or Security findings; Compliance matches the user-authorized follow-up and records the two device/media verification limits above. The requesting user has now accepted this adjusted result and authorized PR creation. Remote freshness was confirmed before pushing. Archive-after-merge remains pending.

## PR delivery preparation (2026-10-30)

- Acceptor: the requesting user/product stakeholder in this task. They exercised the prepared localhost preview, confirmed no further issues, and authorized PR creation with the current screenshots on 2026-10-30 (Asia/Shanghai).
- Adjustments accepted: the three localized benefits, theme-aware panel, semantic typography/elevation, improved legal-text contrast, keyboard focus, reduced-motion CSS, safe-area layout, and localized close label described above.
- Base: successfully refreshed origin/dev at a9954483. The product diff is unchanged from the tested and accepted version; this delivery step updates evidence only.
- Target: dev; head: feat/login-modal-benefits; OpenSpec: login-modal-benefits.
- Visuals: attach the original-before and latest design-audit screenshots as a matched anonymous Chinese/light/1280x720 pair, with the latest mobile/light screenshot as a second visual group. Media remains outside git.
- Version decision: not applicable; only Web presentation and documentation changed.

- Pre-push review: local Bugs, Security, and Compliance passes and an independent read-only reviewer found no Important findings. The PR body includes the accepted screenshot pair, narrow-layout evidence, validation results, and explicit verification limits.
