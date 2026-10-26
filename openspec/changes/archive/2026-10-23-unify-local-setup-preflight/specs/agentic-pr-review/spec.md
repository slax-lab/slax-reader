## ADDED Requirements

### Requirement: Review verdict payloads fail closed

The verdict job SHALL require exactly one `review_verdict` item with a non-negative decimal integer count and a nonblank string summary. Missing, duplicate, or malformed verdicts SHALL fail the job. Only a valid zero count SHALL pass; every positive decimal count SHALL fail, including values larger than the shell integer range.

#### Scenario: Review verdict is absent or malformed

- **WHEN** agent output is missing, invalid JSON, lacks exactly one verdict, or contains an invalid count or summary
- **THEN** the verdict job exits non-zero without reporting a passing verdict

#### Scenario: Positive count exceeds shell integer range

- **WHEN** a verdict reports a positive decimal Important count too large for shell integer comparison
- **THEN** the verdict job still fails and does not interpret conversion failure as zero

#### Scenario: Valid review has no Important findings

- **WHEN** exactly one verdict reports a valid zero count and a nonblank string summary
- **THEN** the verdict job passes
