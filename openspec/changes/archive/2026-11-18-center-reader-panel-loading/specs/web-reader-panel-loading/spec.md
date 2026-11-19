# Spec Delta

## Purpose

Provide a stable loading presentation inside the Web reader sidebar while its on-demand panel code becomes available.

## ADDED Requirements

### Requirement: Center asynchronous panel loading feedback

While the Outline/Summaries or Chat panel code is loading, the reader SHALL display its existing four-dot loading indicator horizontally and vertically centered in the sidebar content area. Desktop tab controls and the mobile grab area SHALL remain usable. This presentation SHALL work at narrow mobile, 768px, and desktop widths in light, dark, and e-ink themes, respecting reduced-motion preferences.

#### Scenario: Open Outline before its code arrives
- **WHEN** the visitor opens Outline and its panel code remains pending
- **THEN** the four dots are centered in the available sidebar content area
- **AND** when loading completes, Outline/Summaries replaces the placeholder using its existing content layout

#### Scenario: Open Chat before its code arrives
- **WHEN** an authorized visitor opens Chat and its panel code remains pending
- **THEN** the four dots are centered in the available sidebar content area
- **AND** when loading completes, the existing Chat interface replaces the placeholder

#### Scenario: Change or close the panel during loading
- **WHEN** the visitor changes panels or closes the sidebar before a panel finishes loading
- **THEN** the selected panel or closed sidebar remains selected when loading completes

### Requirement: Preserve surrounding reader behavior

The loading presentation SHALL retain existing subscription decisions, loaded-panel layout, inline loading indicators, and load-error handling. It SHALL NOT change article navigation, back/forward restoration, or highlight and Outline positioning.

#### Scenario: Profile is pending or inactive
- **WHEN** subscription verification is pending or the visitor has no applicable entitlement
- **THEN** the existing verification feedback or access decision applies without the code-loading placeholder granting access

#### Scenario: Loaded content and reader navigation
- **WHEN** the panel code becomes available and the visitor uses an existing reader navigation or positioning control
- **THEN** the loaded panel keeps its existing layout and the destination retains its existing position behavior
