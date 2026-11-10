# Spec Delta

## Purpose

Present the public reader's existing save-copy action with clear localized wording and consistent star states, while preserving its established admission and retry behavior.

## ADDED Requirements

### Requirement: Localized save-state presentation

The public `/b/[id]` reader SHALL present its existing non-owner save action as an inline star followed by text. The unsaved label SHALL be `收藏本篇` in Chinese and `Save for later` in English; the saved label SHALL be `已收藏` and `Saved`, respectively. A submitting request SHALL display `收藏中…` or `Saving…`. The control SHALL NOT append a checkmark to the saved label or render a trailing check icon. Its offline and failure feedback SHALL use save terminology without changing the existing error flow.

#### Scenario: Reader has not saved the source

- **WHEN** the current viewer has no active or successful copy of the source and the action is ready
- **THEN** the control shows an outline star before the localized unsaved label and remains available under the existing login and online requirements

#### Scenario: Save is admitted or already persisted

- **WHEN** the save request is admitted, or fresh viewer metadata reports a pending or successful copy
- **THEN** the control shows a filled star before the localized saved label, contains no trailing checkmark, remains disabled, and does not navigate away from the source

#### Scenario: Request is in flight or fails

- **WHEN** the save request is in flight
- **THEN** the control shows the localized submitting label and busy state and prevents duplicate activation; if the request fails, the existing feedback appears and the action becomes retryable with the unsaved presentation

### Requirement: Accessible theme-aware visual treatment

The action SHALL have a transparent borderless resting appearance, readable theme-aware text, and a distinct saved treatment. The icon SHALL inherit the control's color and SHALL NOT provide a duplicate accessible name. The action SHALL retain a minimum 44px hit-area height, visible keyboard focus, and its full localized label. Its outline/filled distinction SHALL remain identifiable in light, dark, and e-ink; nonessential motion SHALL be suppressed for reduced-motion and e-ink settings.

#### Scenario: Theme changes

- **WHEN** the reader switches between light, dark, and e-ink
- **THEN** unsaved and saved controls retain readable text and icons, the filled saved star remains distinguishable without relying solely on color, and the saved state is not faded as if it were unavailable

#### Scenario: Keyboard and assistive technology

- **WHEN** the enabled action receives keyboard focus or is read by assistive technology
- **THEN** focus is visibly indicated, the localized text supplies one accessible name, Enter and Space invoke the existing action, and the decorative star adds no repeated announcement

#### Scenario: Responsive localized header

- **WHEN** the public reader is displayed at desktop width, the 768px transition, or 320px in either supported locale
- **THEN** the action and adjacent header controls remain reachable without clipping, overlap, or page-level horizontal scrolling caused by the action

### Requirement: Presentation preserves existing save eligibility

The presentation SHALL follow the current viewer/source state without introducing new save, unsave, refresh, or navigation behavior. Owners SHALL retain the existing absence of this action; unready metadata SHALL prevent activation; anonymous activation SHALL use the existing login flow; persisted failed state SHALL remain retryable. A source or account change SHALL continue to isolate pending and saved state.

#### Scenario: Metadata is unready

- **WHEN** viewer-specific metadata is not ready
- **THEN** the control cannot submit and does not infer a new successful save from missing metadata

#### Scenario: Saved copy becomes retryable

- **WHEN** fresh metadata changes the viewer's copy from active or successful to failed or absent
- **THEN** the control returns to the outline-star unsaved presentation and allows the existing explicit retry once ready
