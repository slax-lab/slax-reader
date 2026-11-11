## MODIFIED Requirements

### Requirement: Supported media plans are processed

The system SHALL admit otherwise eligible YouTube and podcast plans independently of total media duration, text size, chunk count, estimated cost, and accumulated spend. Model requests SHALL remain bounded and large inputs SHALL still be divided into processable chunks. Cost accounting SHALL be preserved even when spending exceeds former caps.

#### Scenario: Long media plan
- **WHEN** a valid source exceeds the former duration, total text, or chunk-count cap
- **THEN** generation starts and processes the complete plan without returning `too_long`

#### Scenario: Cost exceeds former caps
- **WHEN** estimated or actual cost exceeds the former per-run, per-episode, or lifetime cap
- **THEN** generation continues and usage is recorded without a budget rejection

#### Scenario: Long video inside the limits
- **WHEN** a YouTube caption is 2h47m long with fewer than 40 chunks and 400,000 characters
- **THEN** its plan is admitted independently of estimated cost

#### Scenario: Plan still too expensive
- **WHEN** a valid plan costs more than the former per-article budget
- **THEN** the plan is processed rather than skipped and its usage is accounted for
