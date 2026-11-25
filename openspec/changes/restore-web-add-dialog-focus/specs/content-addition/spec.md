## ADDED Requirements

### Requirement: Return keyboard focus when the Add dialog closes

The Web experience SHALL return focus to the specific opener after dismissing the Web library Add dialog.

#### Scenario: Keyboard dismissal

- **WHEN** a reader activates Add with Enter and presses Escape in the URL input
- **THEN** focus returns to the same Add button and Enter immediately reopens it

#### Scenario: Alternate opener

- **WHEN** the dialog is opened from another available launch control and cancelled using its close button
- **THEN** focus returns to that opener and the next Tab follows the surrounding order

#### Scenario: Route change

- **WHEN** submission navigates to another view before dismissal finishes
- **THEN** focus stays in the destination rather than moving to a detached opener
