## Purpose

Show a localized length error and block invalid new comments and replies before either local or direct submission. Retain the draft for correction.

## ADDED Requirements

### Requirement: Explain the comment length limit before submission

The Web experience SHALL show a localized length error and block invalid new comments and replies before either local or direct submission. Retain the draft for correction.

#### Scenario: Oversize reply

- **WHEN** the reader pastes a 1,501-unit reply and presses Enter or clicks Send
- **THEN** the draft is retained with an actionable length message and no mutation is queued or submitted

#### Scenario: Boundary

- **WHEN** the reader shortens the draft to exactly 1,500 units and submits
- **THEN** the valid comment can be saved and a subsequent valid edit proceeds

#### Scenario: Unicode and input methods

- **WHEN** a draft includes emoji or is being composed with an IME
- **THEN** the committed draft uses the existing UTF-16 measure and intermediate composition does not trigger an unintended send
