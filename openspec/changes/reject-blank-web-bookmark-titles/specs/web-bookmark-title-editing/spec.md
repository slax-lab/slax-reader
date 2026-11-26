## Purpose

Reject whitespace-only renames with an inline explanation. Allow correcting the title without losing the previous one.

## ADDED Requirements

### Requirement: Prevent whitespace-only bookmark titles

The Web experience SHALL reject whitespace-only renames with an inline explanation. Allow correcting the title without losing the previous one.

#### Scenario: Invalid list rename

- **WHEN** the reader replaces a title with spaces or tabs and confirms or leaves the input
- **THEN** an understandable validation outcome is shown, no blank alias is written and the prior usable title remains available

#### Scenario: Correct and retry

- **WHEN** a reader supplies a valid replacement after a rejected rename
- **THEN** the normal rename path accepts the corrected title

#### Scenario: Legacy blank alias

- **WHEN** an existing article has a nonempty original title and a whitespace-only alias
- **THEN** its library row and reader show a usable title
