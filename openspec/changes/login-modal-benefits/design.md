# Design

## Context

See proposal.md for intent and scope. LoginModal is a self-contained bootloader-mounted Vue component with scoped styles and a manual i18n accessor. It already consumes Web theme tokens. The reference was inspected in its anonymous Chinese state on 2026-10-30 by activating “收藏本篇”.

The reference benefits list has 14px text, 14px 18px panel padding, 22px bottom margin, 12px radius, and list items with 5px vertical padding plus 24px space for the leading checkmark. Its light background is RGB(246, 238, 229), and its body copy is RGB(61, 55, 49).

## Goals / Non-Goals

**Goals:** reproduce the reference's compact benefits treatment inside the existing modal and retain theme-aware rendering and natural localized wrapping.

**Non-goals:** import reference markup, add a new shared component or token system, or change provider authentication.

## Decisions

- Add a semantic list directly to LoginModal, before `.auth-btns`. Three static locale keys use the component's existing translation accessor. A shared component is unnecessary because the standalone login page is outside scope.
- Use the existing meta font-size token (14px), accent-background, text, accent, and radius tokens. Keep the reference's local spacing. This deliberately follows the current theme palette and radius scale instead of introducing fixed reference-only color and radius values.
- Use an aria-hidden checkmark span in each row, with a fixed leading area and naturally wrapping text. No imported SVG, registry addition, dependency, or CSS-generated spoken content is needed.
- Preserve the existing modal width and surrounding content. Bound the card to the viewport height minus the safe-area-aware overlay insets (at least 24px each), and allow internal vertical scrolling with contained overscroll. This keeps the close control reachable and exposes provider/legal controls on short viewports without unlocking the page behind the modal.

## Risks / Trade-offs

- [The added content increases modal height and English text wraps more] → Check desktop, 768px, and 320px layouts plus a short mobile viewport, with both login providers visible.
- [The reference uses a different light palette] → Match its hierarchy and spacing with approved semantic tokens; do not claim pixel-identical color reproduction.
- [Real OAuth needs service configuration] → Exercise presentation, provider availability, redirect preservation, and dismissal locally; record any unavailable end-to-end authentication verification explicitly.

## Design conformance corrections

- Use display/h2 for the desktop/compact brand title, meta/aux for the subtitle, and tag for legal text. Keep secondary copy and the close icon on the muted-text role instead of the lower-contrast light-text role.
- Use modal elevation and the shared blur/easing tokens. Keep these changes scoped to LoginModal; provider components retain their shared behavior and fixed brand artwork.
- Add accent focus-visible outlines to the close button, provider buttons, and legal links. Reuse the existing localized close label and hide its decorative SVG from assistive technology.
- Disable modal/control transitions and entrance/press transforms under prefers-reduced-motion. Existing host e-ink suppression continues to apply.
- Set overlay insets to the larger of 24px and each device safe area. Derive the card's maximum height from those top/bottom insets so short screens retain internal scrolling.
