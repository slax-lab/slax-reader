# Spec Delta

## ADDED Requirements

### Requirement: Collection guidance remains above the page header

On an eligible public subscription collection page, the external-browser guidance card SHALL render above the page header wherever they overlap. Its guidance text and close control SHALL remain visible and operable while the card is shown, including after scrolling, without shifting the page layout.

#### Scenario: Guidance overlaps the collection header

- **WHEN** an eligible embedded browser displays the guidance on a public subscription collection page
- **THEN** the overlapping guidance text and close control appear above the header
- **AND** pointer input at the close control reaches the guidance rather than the underlying header

#### Scenario: Collection is scrolled while guidance is visible

- **WHEN** the visitor scrolls an eligible collection page while the guidance remains visible
- **THEN** the guidance remains above the fixed header and retains its existing viewport position

#### Scenario: Guidance is dismissed over the header

- **WHEN** the visitor closes the guidance with its close control or an upward drag past the existing threshold
- **THEN** the guidance disappears with its existing manual-close and cooldown behavior
- **AND** the header is exposed for normal interaction without a layout shift

### Requirement: Guidance has consistent priority on eligible pages

Guidance SHALL use the same elevated stacking priority on every eligible page without route-specific layering. It SHALL remain above lower or equal in-page overlays in its layout context, including the subscription modal and collection-management confirmation. Its existing detection, route exclusions, and dismissal behavior SHALL remain unchanged.

#### Scenario: Subscription modal is open

- **WHEN** eligible guidance and the subscription modal are displayed on a promotion surface
- **THEN** the guidance remains above the subscription modal overlay in their overlapping region
- **AND** pointer input in that region reaches the guidance

#### Scenario: Collection-management confirmation is open

- **WHEN** eligible guidance and the collection-management confirmation are displayed together
- **THEN** the guidance retains the same elevated priority above the confirmation and its backdrop in their overlapping region

#### Scenario: Navigation leaves a public collection

- **WHEN** a reader navigates from a public collection page to another eligible route without dismissing the guidance
- **THEN** the guidance retains the same elevated layer
- **AND** returning to the public collection does not change its stacking priority
