## ADDED Requirements

### Requirement: Distinguish processed rows from a completed import

The Web experience SHALL use a finalizing label when all rows are accounted for and the task is active. Only a confirmed terminal status may indicate completion.

#### Scenario: All rows accounted for

- **WHEN** the active task reports one processed row out of one
- **THEN** the reader sees finalizing and the counts, without a claim that the task has completed

#### Scenario: Last fraction

- **WHEN** an active task has 199 of 200 rows processed
- **THEN** the progress display still distinguishes it from a fully processed batch

#### Scenario: Terminal update

- **WHEN** a later refresh or reopened modal receives complete or failed status
- **THEN** the matching terminal state replaces finalizing and retains the reported counts
