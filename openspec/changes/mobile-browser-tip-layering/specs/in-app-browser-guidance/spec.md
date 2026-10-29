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
