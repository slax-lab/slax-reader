# Proposal

## Why

The Web LoginModal currently offers sign-in actions without explaining the reading benefits. The user requested the three benefit statements and their visual treatment from the supplied interactive reference: https://claude.ai/artifact/RCqquktdZzjguYRoZ9uQtq.

## What Changes

- Add a compact, left-aligned benefits panel between the existing subtitle and Google/Apple sign-in buttons.
- Show the exact Simplified Chinese copy, in order: “无限抓取保存与分享”, “在任何设备继续阅读”, and “建立自己的高质量、无干扰内容空间”. Provide equivalent English locale entries.
- Match the reference panel's warm tinted background, rounded corners, 14px text, generous inset, and accent checkmarks, using Web semantic tokens for light, dark, and e-ink.
- Preserve the existing title and subtitle copy, provider controls, Apple availability, redirect handling, dismissal, and legal links.

## Capabilities

### New Capabilities

- `web-login-modal`: Localized benefit presentation in the existing Web sign-in modal, with responsive and theme-aware styling.

### Modified Capabilities

None. Existing migration and authentication specifications do not own this presentation requirement; no active change carries a delta for `web-login-modal`.

## Impact

- `apps/web/app/components/Modal/LoginModal.vue`
- `apps/web/i18n/locales/zh.json` and `en.json`
- Existing LoginModal regression checks and browser verification evidence.
- No API, dependency, shared-package, Extension, Mobile, or CLI changes. No application version decision is required for this Web-only adjustment.

## Non-goals

Redesigning the whole modal, changing the standalone LoginView, importing the reference's article-specific subtitle or mock authentication flow, or changing OAuth behavior.

## Design checkpoint

This is a local component adjustment within the existing approved pattern, exempt from the material-UX demo offer under DESIGN.md section 10.1. The requesting user approved this proposal in conversation on 2026-10-30 (Asia/Shanghai) and authorized implementation. No adjustments were requested. The requesting user completed hands-on acceptance of the final running UI on 2026-10-30 and authorized opening a pull request with the updated screenshots; see validation.md.

## Workspace

Worktree: `/Users/yjc/.codex/worktrees/login-modal-benefits/slax-reader-v2`.
Branch: `feat/login-modal-benefits`, based on locally available `origin/dev` at `a9954483`. The initial remote fetch failed with DNS resolution errors. A successful pre-push fetch on 2026-10-30 confirmed origin/dev remains at a9954483; no rebase was needed.

## Design conformance follow-up

On 2026-10-30, the requesting user asked for an audit against the current project design contract and explicitly authorized corrections. The benefits panel already follows the Web tokens. This follow-up brings the surrounding modal into conformance with DESIGN.md sections 5.3–5.5, 7.4, and 8: use the semantic type scale and modal elevation/blur, improve secondary-text contrast, provide visible keyboard focus, respect reduced motion, preserve safe-area insets, and localize the close control's accessible name. These are local corrections within the existing pattern; content, provider behavior, and layout structure remain unchanged. The requesting user reviewed the adjusted running result and accepted it on 2026-10-30, with no additional changes requested, and authorized the PR.
