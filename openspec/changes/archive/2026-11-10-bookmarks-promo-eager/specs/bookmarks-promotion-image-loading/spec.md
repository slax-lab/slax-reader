# Spec Delta

## Purpose

Avoid lazy-loading delay for an eligible desktop bookmarks promotion while retaining the existing hidden narrow-screen and account-gated behavior.

## ADDED Requirements

### Requirement: Desktop promotion loads eagerly after eligibility

Once the existing account, eligibility, and KOC gates permit the localized promotion image to appear, the Web application SHALL use eager loading at viewport widths of at least 921 CSS pixels. It SHALL retain lazy loading below that breakpoint and SHALL leave request priority at the browser default. Eligibility timing, language selection, image sources, layout, and claim interaction SHALL remain unchanged.

#### Scenario: Eligible desktop promotion
- **WHEN** an eligible user sees the promotion at a viewport width of at least 921 CSS pixels
- **THEN** the selected Chinese or English image uses `loading="eager"` without an explicit elevated fetch priority

#### Scenario: Narrow-screen promotion remains hidden
- **WHEN** the viewport is narrower than 921 CSS pixels
- **THEN** the existing CSS visibility rules remain in effect and the promotion image retains lazy loading

#### Scenario: Eligibility has not permitted the promotion
- **WHEN** existing account, eligibility, or KOC gates do not permit display
- **THEN** the promotion image is not inserted or preloaded by this change
