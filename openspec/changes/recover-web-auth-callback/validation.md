# Validation

Date: 2026-11-05. Supplement prepared in the existing clean `fix/powersync-release-recovery` worktree for PR #467. No new branch or PR, production deployment, Cloudflare setting change, real account, or real OAuth code was used.

## Scope and approval

The requester approved the minimal callback fallback in conversation: persistent failure state, approximately 20-second waiting limit, and a new provider authorization rather than reusing the old callback code. `proposal.md` records this review. PowerSync transport errors and failures before callback page setup are separate investigations.

## Automated checks

All commands ran from this worktree with explicit synthetic Web configuration: `SLAX_ENV=development` (production for the build), `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL`, and `DWEB_API_BASE_URL` set to `http://localhost:44020`, `COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=slax_auth_probe`, `GOOGLE_OAUTH_CLIENT_ID=local-diagnostic-only`, and optional provider/telemetry keys empty. No secret configuration file was inspected.

- Baseline: `pnpm --dir apps/web test tests/unit/composables/useAuth.spec.ts tests/unit/components/GoogleLoginButton.spec.ts`: 24 passed.
- Red: the new pending-login and canceled-late-response regressions both failed against the old implementation. The callback had no recovery region after 20 seconds, and the canceled login resolved with a token instead of rejecting before cookie storage. A test-router mock mismatch was corrected before recording this red run; the recorded run had no unhandled test-environment error.
- Targeted green: `pnpm --dir apps/web test tests/unit/pages/auth.spec.ts tests/unit/composables/useAuth.spec.ts tests/unit/components/GoogleLoginButton.spec.ts tests/unit/components/AppleLoginButton.spec.ts`: 47 passed.
- Full Web suite: `pnpm --dir apps/web test`: 225 files passed, one skipped; 2,599 tests passed, three skipped, exit 0. The existing happy-dom fetch-abort teardown diagnostic still appears in the passing run; it is not a new callback rejection.
- `pnpm --dir apps/web typecheck`: passed, exit 0.
- Changed-file ESLint for the page, composable, regressions and fixture JavaScript/TypeScript: passed, zero errors. `git diff --check`: passed.
- `pnpm web -- build` using the production profile and default Cloudflare Pages preset: passed, exit 0. An initial attempt to force the node-server preset failed because the production Pages post-build hook expects `_routes.json`; no product workaround was added, and the normal production preset passed.
- `pnpm exec openspec validate --all --strict`: 95 passed, zero failed. Existing long-requirement informational notices remain.

## Running browser exercise

The committed fixture imports the real callback Vue page, provider buttons, login composable, Web request client, cookie utilities, localized messages, theme styles and UnoCSS configuration. It substitutes Nuxt configuration/navigation boundaries and the unused user-store cleanup boundary, serves synthetic API responses locally, and redirects provider authorization to local receipt pages. It does not simulate Google accepting an account or issue a real Slax session.

Commands:

```sh
node apps/web/tests/fixtures/auth-recovery/serve.mjs 44020
node apps/web/tests/fixtures/auth-recovery/serve.mjs 44021 --baseline
python3 apps/web/tests/fixtures/auth-recovery/browser-check.py
```

The baseline pins the pre-fix PR revision `08bf850a9272d45211b974a1876324560f054ef8`, so a later commit cannot silently replace the before state. The browser runner uses installed headless Google Chrome, not a user browser profile. It completed 44 checks:

- Previous implementation: disconnected login produces a raw TypeError toast and retains the spinner after that toast disappears.
- Repaired implementation: a disconnected request, HTTP provider rejection, malformed state, and rejected success navigation display persistent localized recovery without a raw toast or unhandled rejection.
- A genuinely pending HTTP request was allowed to run for 20 real seconds. It switched to timeout recovery, canceled the request, and wrote no login cookie. The local HTTP service recorded client cancellation.
- Google and Apple recovery buttons start new authorization, carry valid return/referral context, and contain no old callback code in the new authorization URL. Malformed state offers the default Google/bookmarks path.
- Success uses the real cookie utility to store the synthetic session token and navigates to the preserved destination.
- Failure and timeout states were exercised in light, dark, and e-ink, at 320/768/1280px, in English and Chinese: enabled visible recovery action and no horizontal overflow. The matrix's pending cases use an accelerated browser clock; the primary timeout case above uses real time.
- Regression tests additionally cover page-disposal cancellation, prevention of late cookie writes/navigation, missing-code routing, and the Android handoff.

Local artifacts (not committed): `/tmp/slax-auth-recovery-evidence/results.json`, `http-requests.json`, the 1280px light before/after pair, and Chinese recovery captures for all three themes and widths. This fixture uses real HTTP disconnections; Chromium can retry a reset connection at its network layer. No application-level automatic replay of the callback code is implemented; the recovery button itself starts a new authorization rather than posting the old code.

Fixture setup corrections: the standalone runner explicitly enables Nuxt's client branch, starts from the Web directory so icon collections resolve, passes the real UnoCSS config path, and keeps Vite's dependency cache under node_modules so dependency code is not scanned as application attributes. The missing-icon investigation checked official UnoCSS extraction/configuration guidance and the installed plugin API; alternatives included explicit config loading, safelisting with presets, and standalone CSS generation. Only fixture setup changed. Earlier failed fixture attempts are not claimed as passing running evidence.

## Native Safari exercise

Safari Technology Preview on this Mac opened the same real-component/local-HTTP fixture. Disconnect changed the callback to persistent “Sign-in not complete” guidance and an actionable Google Login button. Activating it reached the local fresh-authorization receipt with the valid return/referral context. A separate pending request initially displayed Authenticating and subsequently displayed “Sign-in timed out. Please check your connection and sign in again.” with the Google Login action. This verifies native desktop WebKit behavior, not iPhone Safari or production networking.

## Review

REVIEW.md Bugs/Security/Compliance passes were applied to the supplement, using change ID `recover-web-auth-callback` alongside the existing `powersync-release-recovery` PR scope. Claude Code's initial source-only review found no confirmed Important Bugs or Security issue; it requested the unchanged provider-button wiring and this evidence record. Those sources and the live authorization receipts resolve the wiring question. The final source review was supplied the real provider controls, request implementation, evidence, baseline page and actual diff. Claude Code concluded that no concrete new defect remained and the supplement is ready for human hands-on acceptance. Its conditional external-redirect question was resolved by the pre-fix page, which already used the same external navigation; no unrelated redirect-policy change was added. Local Bugs/Security/Compliance review agrees: no Important implementation finding remains; human acceptance/publication is still pending.

## Human hands-on acceptance and adjustments

On 2026-11-05, requester Yaojunchang exercised the local preview, including the success destination, and reported that the overall recovery layout looked OK. The requester asked why the success destination had no styled UI and requested a suitable SVG icon above the failure heading. The in-app browser's visible success receipt confirmed that this was the intentionally plain synthetic completion destination; production success still navigates to the real requested list page.

The requested local visual adjustment was implemented: a static, application-authored 32px circled-exclamation SVG in a 56px accent-tinted circular surface above the title, with currentColor paint and aria-hidden/non-focusable semantics. No login or retry behavior changed. The human accepted the overall page and requested this adjustment; automated checks below verify the adjustment, without claiming that the requester separately inspected every theme or the final icon pixels. This records the implemented-preview review and requested-adjustment/reverification sequence required by DESIGN.md section 10.2. Publish as a supplement to existing PR #467, without a new branch or PR.

### Verification after the icon adjustment

- Targeted callback/composable/provider-button suite: 47 passed. The last full Web suite before this markup/style-only adjustment remains 2,599 passed / three skipped; no new decorative-icon unit test was added to mirror SVG geometry.
- The actual Chrome/HTTP fixture runner passed all 44 checks again with the icon present, including failure/timeout in all three themes, English/Chinese, and 320/768/1280px widths.
- A separate running design audit at 375x667px with reduced motion enabled confirmed 22px semantic headings, 16px body text at 1.6 line height, 44px-high login controls, visible keyboard focus in all themes, no horizontal overflow, a 32px SVG with aria-hidden=true/focusable=false, and no icon animation. Body-text contrast against the real theme background measured 5.86 (light), 5.83 (dark), and 12.63 (e-ink). The SVG uses the existing application-owned inline-geometry pattern; no external SVG was imported.
- Follow-up typecheck, default production Cloudflare Pages build, changed-file lint, and strict OpenSpec (95 passed, zero failed) all passed after the SVG adjustment, with exit 0. Local evidence additionally includes design-audit.json and focused-state screenshots under /tmp/slax-auth-recovery-evidence/.
- The decorative SVG/semantic styles were reviewed locally under REVIEW.md's Bugs/Security/Compliance passes; they introduce no asynchronous logic, external data, or new code paths. The prior independent callback review remains applicable.

## Explicit verification gaps

- No real Google/Apple account exchange, deployed API integration, production CORS/CDN/network reproduction, real Google invalid_grant exchange, iPhone device run, or production latency measurement. Provider rejection and disconnection are controlled local faults.
- The standalone fixture does not boot Nuxt's full plugin/PowerSync startup chain. A production-profile full build passed, but plugin stalls before page mount remain outside this callback-scoped correction.
- Full hosted Extension/CLI/Mobile smoke is not repeated: no shipped package, shared package, API contract, or extension bridge source is changed by this supplement. The original PR's Extension version decision remains unchanged.
- Human review covers the preview and overall layout, with the requested SVG adjustment re-verified as described above; native phone appearance and production account integration remain unverified.

## Publication receipt

The supplement was committed as `6cedecec` and pushed to the existing `fix/powersync-release-recovery` branch on 2026-11-05. Existing PR #467 was updated in place with both OpenSpec IDs, the human review/adjustment record, verification limits, and two callback before/after attachments. No new branch or PR was created, and no deployment or merge was performed. The final documentation follow-up closes the delivery checkbox.

![OAuth callback before: raw TypeError toast and persistent spinner, light theme, 1280px, synthetic local login disconnect](https://github.com/user-attachments/assets/f458b293-4d5f-4080-ab86-f29535b91c51)

![OAuth callback after: persistent recovery with status SVG and fresh Google sign-in, light theme, 1280px, synthetic local login disconnect](https://github.com/user-attachments/assets/04623412-90ec-4bdf-944a-8af749b5fbc0)
