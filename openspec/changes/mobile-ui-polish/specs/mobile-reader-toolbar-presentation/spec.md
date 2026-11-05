# Spec Delta

## Purpose

Keep the Mobile Reader More panel's action tiles consistently sized and position its Pro badge clearly without changing menu behavior or touch targets.

## ADDED Requirements

### Requirement: Reader action tiles retain their size and aligned Pro badge

The Reader More panel SHALL retain 56 by 56 logical-point icon tiles, their existing labels, and the spacing between tile and label. Each tile's action icon SHALL render in a centered 24 by 24 logical-point frame, including selected and document-specific variants. The label remains outside the tile, so the complete action SHALL NOT be constrained to a 56-point total height. A Pro badge SHALL align its visible artwork with the tile's top edge and horizontal center, preserve the source image aspect ratio, and retain its current visible width. Its placement SHALL NOT shift the action icon or label, intercept action taps, or add an independently focusable accessibility element.

#### Scenario: The More panel is opened
- **WHEN** the user opens the Reader More panel
- **THEN** action icon tiles measure 56 by 56 logical points and their labels remain beneath them
- **AND** each action icon is centered inside its tile at 24 by 24 logical points
- **AND** the Pro badge is centered horizontally at the top of its tile without square-image letterboxing
- **AND** all existing actions, disabled states, and touch targets remain functional
