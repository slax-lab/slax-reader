# In-App Browser Tip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a conservative, localized, dismissible external-browser instruction on eligible Web pages opened inside third-party app browsers.

**Architecture:** A pure user-agent classifier determines eligibility; a client-only global component in the default layout handles route policy, pointer drag dismissal, localStorage close counting with a one-hour cooldown, accessibility, and themed floating presentation. Unknown and ordinary browser environments default to hidden.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vue Test Utils, Vitest, existing Web semantic tokens and i18n.

**Spec:** `openspec/changes/in-app-browser-tip/specs/in-app-browser-guidance/spec.md` and `openspec/changes/in-app-browser-tip/design.md`

## Global Constraints

- Unknown or ordinary external browser user agents MUST remain hidden.
- The feature MUST be client-only and MUST exclude Slax Reader native, standalone PWA, protocol, and technical routes.
- New Web UI MUST use `--slax-*` semantic tokens and cover light, dark, and e-ink behavior.
- The card MUST not change document layout height.

## Review Focus

- Safari/Chrome false positives: test normal external UA strings remain hidden in the classifier.
- iOS in-app browser ambiguity: do not broaden detection beyond explicit markers; test unknown Safari-like strings remain hidden.
- Android WebView specificity: require Android plus `; wv`; test ordinary Android Chrome remains hidden.
- Route persistence: test client navigation to excluded protocol/technical paths hides the card.
- Storage failure: test localStorage access errors do not break rendering or repeated manual closes during the current runtime.

### Task 1: Conservative classifier

**Files:**
- Create: `apps/web/app/utils/inAppBrowser.ts`
- Test: `apps/web/tests/unit/utils/inAppBrowser.spec.ts`

**Interfaces:**
- Produces `detectInAppBrowser(userAgent: string): InAppBrowserKind | null` and `isInAppBrowser(userAgent: string): boolean`.

- [ ] Write tests for explicit WeChat, Instagram, Facebook-family, YouTube, Android WebView, ordinary browser, unknown, and SlaxReader cases.
- [ ] Run the focused test and confirm new tests fail before implementation.
- [ ] Implement marker matching with unknown defaulting to `null`.
- [ ] Run the focused test and confirm all classifier cases pass.

### Task 2: Guidance component and localization

**Files:**
- Create: `apps/web/app/components/Tips/InAppBrowserTip.vue`
- Modify: `apps/web/i18n/locales/zh.json`
- Modify: `apps/web/i18n/locales/en.json`
- Test: `apps/web/tests/unit/components/Tips/InAppBrowserTip.spec.ts`

**Interfaces:**
- Consumes the classifier and current route; produces a client-only dismissible status card.

- [ ] Write component tests for visible/hidden states, close persistence, accessible close label, and route exclusions.
- [ ] Implement localStorage-backed manual close counting, one-hour cooldown, and client-only detection with no focus stealing.
- [ ] Implement the compact floating card with safe-area offsets, semantic tokens, focus-visible treatment, and reduced-motion behavior.
- [ ] Add Chinese and English copy for the message and close control.
- [ ] Run the focused component tests.

### Task 3: Global integration and verification

**Files:**
- Modify: `apps/web/app/layouts/default.vue`
- Modify: `apps/web/app/components/Tips/InAppBrowserTip.vue` if integration details require it

- [ ] Mount the component inside the default layout without adding document-flow height.
- [ ] Verify protocol and technical routes remain excluded while ordinary pages are eligible.
- [ ] Run targeted Web tests, typecheck, lint, and strict OpenSpec validation.
- [ ] Review the final diff for false-positive detection, theme compliance, accessibility, and route coverage.
