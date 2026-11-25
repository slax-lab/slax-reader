## ADDED Requirements

### Requirement: Expose library search at narrow widths

The Web experience SHALL expose a labeled compact search action at the narrow breakpoint and reuse the existing search input and results flow.

#### Scenario: Phone browser

- **WHEN** a reader opens the Web library at 390px, activates Search and submits a keyword
- **THEN** the input takes focus and the matching results are visible without horizontal scrolling

#### Scenario: Breakpoint and keyboard

- **WHEN** the reader navigates with a keyboard at 320px, 860px and just above the breakpoint
- **THEN** one search entry is reachable, it has an accessible name, and dismissal restores usable focus

#### Scenario: Embedded view

- **WHEN** the Web library is displayed in an App browser and the on-screen keyboard opens
- **THEN** the query and submit or return action remain usable
