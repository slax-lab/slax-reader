# Proposal

## Why

The current onboarding flow assumes every visitor can install and configure the browser extension. Mobile browsers cannot install that extension, so the onboarding instructions are unusable and the existing skip control is easy to miss on narrow screens. Mobile visitors need a direct path to the Slax Reader app and an explicit way to close onboarding.

## What Changes

- Detect mobile onboarding sessions separately from desktop extension onboarding.
- Replace the mobile extension installation tutorial with App Store or Google Play download guidance.
- Open the detected platform's app store in a new tab; use the official Slax Reader download page when the mobile platform cannot be identified.
- Keep a visible mobile close action that records the existing per-account onboarding dismissal before returning to the root Inbox.
- Preserve the current desktop extension onboarding flow and its automatic installation detection.
- Add localized mobile copy and focused unit coverage for platform routing, mobile rendering, and manual dismissal.

## Capabilities

### New Capabilities

- `mobile-onboarding-app-download`: Mobile onboarding content, platform-specific app download navigation, and explicit close behavior.

### Modified Capabilities

<!-- No existing living capability spec covers the onboarding UI contract. -->

## Impact

- `apps/web/app/pages/onboarding.vue` and `apps/web/app/components/BookmarkList/BookmarksOnboardingHero.vue`.
- Mobile platform detection and app-download URL selection in the Web client.
- English and Chinese onboarding locale entries.
- Onboarding page and hero unit tests.
- No API, database, or dependency changes.
