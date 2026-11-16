# Design

## Context

See proposal.md for scope. The existing page uses scoped SCSS with UnoCSS `--style` directives and Web theme tokens. Its only phone override is 16px horizontal padding. The Google login component already has a 44px button and theme-aware styles. No existing living capability specifies this guide's layout; the active public-page-startup work concerns startup behavior and remains separate.

## Goals / Non-Goals

**Goals:** Keep layout adjustments page-local and CSS-driven, preserving one DOM and the existing authentication handlers.

**Non-Goals:** No device detection, new components, dependencies, native Mobile changes, authentication changes, new tutorial content, or general theme migration.

## Decisions

- Add page-local overrides at `max-width: 768px`, matching the current page breakpoint. CSS avoids device-detection hydration differences and preserves desktop rules.
- Use a compact vertical welcome section with an approximately 72px illustration, wrapping text, and existing heading-scale tokens. Retain 16px minimum side gutters plus applicable safe-area insets.
- Stack cards using normal document scrolling, remove phone-only horizontal scroll/snap and edge masks, reset card margins/minimum height, and use full available card width. A carousel was considered; vertical cards make all three steps discoverable without a new interaction.
- Use fluid image widths with automatic height and a maximum matching their existing display width. Stack the footer with a bounded full-width login action. Keep it in document flow rather than introducing a sticky overlay.
- Reuse all current theme colors. Do not introduce new motion; retain existing e-ink and reduced-motion suppression.

## Risks / Trade-offs

- [The page becomes taller] → Preserve logical step order and place the current action after the cards; verify the entire scroll path.
- [Long English strings or nested flex widths overflow] → Check Chinese and English at 320px and allow shrinking/wrapping at the layout boundary.
- [The tutorial describes a desktop extension] → Preserve requested content; this change improves phone presentation, not mobile product onboarding.
- [Shared button sizing could affect other pages] → Scope sizing to this page's footer; leave the shared component unchanged.

## Migration Plan

Ship as a normal Web change. Reverting the page-local responsive overrides restores the previous layout. No persisted state or data migration is involved.

## Owner-requested metadata follow-up

After UI acceptance, the owner added a build-only Mobile increment from 800 to 801. The authoritative source is `apps/mobile/package.json`; Expo `prebuild` regenerates Android versionCode, share metadata, iOS main/share versions, and both native runtime versions. Marketing version remains 1.0.28. This narrow metadata exception does not change the Mobile behavior exclusions above. No local signing, upload, or store delivery is included.
