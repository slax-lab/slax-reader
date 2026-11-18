# Design

## Context

See proposal.md for the approved intent. `/b/[id]` passes `DotLoading` directly to both asynchronous AI and Chat components. Its four dots only have row layout. `SnapshotSidePanel` supplies a full-height scrolling slot but does not align children. Loaded AI and Chat components own their own layouts. The mobile sheet reserves 20px for its grab area inside the flex body.

## Goals / Non-Goals

**Goals:** Give the asynchronous placeholder a definite content-area height without affecting loaded content or shared inline indicators.

**Non-Goals:** Changing the generic dot component, access state machine, async timing/timeouts, network policy, sidebar layout, or content generation indicators.

## Decisions

1. Add `SnapshotPanelLoading.vue`, reusing `DotLoading` inside a full-width, full-height flex container aligned on both axes. Use it only as `loadingComponent` for the two existing asynchronous declarations. A global change to `DotLoading` would also alter inline chat and generation indicators; centering the parent slot would alter loaded content.
2. Reuse the existing localized loading label as a status accessible name. Hide decorative dots from the accessibility tree. Limit reduced-motion suppression to this new wrapper; retain the existing e-ink stylesheet's animation suppression and the existing dot palette.
3. Verify the actual slot geometry with the JavaScript module response deliberately held in the existing opt-in real-reader lab. Compare the indicator center against the visible slot center after the mobile sheet transition settles. Release the module and verify replacement without changing the selected panel.

## Risks / Trade-offs

- Percentage height must resolve through the actual sidebar slot, including the mobile sheet → measure both panels at 375px, 768px, and 1280px; do not assume component-only markup proves centering.
- Development preloading can hide the brief state → hold the component module response before navigation and release it explicitly.
- This change does not add a new loading-error recovery path → retain the existing async timeout and error boundary.
