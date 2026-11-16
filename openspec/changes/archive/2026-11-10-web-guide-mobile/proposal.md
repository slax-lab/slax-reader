# Proposal

## Why

The Web `/guide` page only reduces horizontal padding on narrow screens. Its non-wrapping welcome text, fixed-width tutorial images, horizontal cards, and inline login footer do not fit a comfortable phone reading flow.

## What Changes

- At widths up to and including 768px, stack the three existing tutorial cards vertically in their original order.
- Scale the welcome illustration and heading for phones, allow localized text to wrap, and fit tutorial images within their cards without cropping or distortion.
- Stack the login prompt and action, make actions fit the available width, and respect device safe areas.
- Preserve the desktop layout above 768px, current guide content, authentication actions, and Web light/dark/e-ink tokens.
- Verify at 320, 375, 390, 768, 769, and 1440px, with Chinese and English text and both authentication footer states.

## Capabilities

### New Capabilities

- `web-guide-layout`: Responsive presentation of the existing Web welcome guide and its primary action.

### Modified Capabilities

None.

## Impact

- Primary implementation: `apps/web/app/pages/guide.vue`, using the existing Vue/SCSS/UnoCSS setup and Web semantic tokens.
- No API, runtime dependency, Extension, or native Mobile behavior changes. Existing browser-extension instructions remain unchanged; mobile-specific onboarding content is outside this layout task.
- This changes the whole-screen phone arrangement. An optional layout demo has been offered in conversation; proposal review is required before implementation, and human hands-on acceptance is required before a PR opens.

## Proposal Review

The requesting human reviewed the written phone layout proposal and approved implementation on 2026-11-04 ("确认"). They chose written review rather than a demo. The approved scope is the responsive layout described above; subsequent hands-on acceptance is recorded in validation.md and below.

After viewing the implemented preview on 2026-11-04, the owner accepted the UI and requested commit/PR delivery. In the same request, they explicitly added a Mobile build-only increment from 800 to 801, retaining marketing version 1.0.28 and setting previousBuildNumber to 800. This metadata-only follow-up is included in this task and uses Expo to synchronize native versions.
