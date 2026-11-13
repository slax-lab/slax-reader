## ADDED Requirements

### Requirement: Accept nonempty model content

Polishing and translation SHALL accept nonempty model content without numeric, length, language, duplication, speaker-name, cue-coverage or cue-order quality gates. Such properties SHALL NOT trigger regeneration, source substitution or publication failure. Transcript admission SHALL reject only empty speech content, not low speech density. Generation SHALL retain empty-output checks and executable protocol requirements, including parseable responses and translation item mapping. Provider failures, truncation, missing stored chunks and failed writes SHALL remain recoverable execution errors. Diagnostic logs SHALL contain identifiers, counts and error codes rather than transcript or response bodies.

#### Scenario: Nonempty content previously rejected by quality scoring
- **WHEN** a parseable nonempty polish or translation result changes numeric representation, length, language, repeated wording, speaker labels or source references
- **THEN** the system accepts it without content-driven retries and publishes after all required output objects are written

#### Scenario: Empty output
- **WHEN** a generated paragraph or required translation item is empty or missing
- **THEN** the system does not publish an empty article and uses bounded recovery

#### Scenario: Execution error
- **WHEN** the provider truncates the response or a required object cannot be read back after writing
- **THEN** the system does not mark the incomplete article ready
