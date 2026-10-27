## ADDED Requirements

### Requirement: Completion evidence follows the requested outcome

Verification SHALL cover the original user request and reported input, in addition to the proposal and delta-spec scenarios.
The record SHALL distinguish the requested outcome from narrower component checks.
A scope reduction SHALL identify the user's instruction that authorizes it.
The author SHALL NOT claim completion for an outcome supported only by fixtures, intermediate states, or a declared verification gap.

#### Scenario: Recovery controls pass while generation remains unverified
- **WHEN** error and retry controls pass with simulated status responses
- **THEN** the evidence verifies only those controls
- **AND** the author does not claim that article generation succeeded

#### Scenario: The user changes the immediate acceptance target
- **WHEN** the user requests visitor transcript access as the immediate target
- **THEN** the evidence records that instruction and checks transcript access with a visitor role
- **AND** the record keeps generated article access separate

### Requirement: Evidence states dependency and persistence boundaries

Each requested outcome SHALL record its input, reader role where applicable, running environment, real dependencies, substituted dependencies, and observed result.
Each outcome SHALL use a result of verified, partial, or unverified, with the limits stated.
For asynchronous work, completion evidence SHALL include the terminal result and a separate read of the saved output.
For shared output, that read SHALL use the intended reader role.
Fixture screenshots SHALL be labeled as fixture evidence in the evidence record and attachment description.
These requirements SHALL NOT authorize additional access, paid operations, or production changes.

#### Scenario: A completed job has no readable saved result
- **WHEN** a job finishes but the intended reader cannot retrieve its saved result
- **THEN** the requested readable-output outcome remains partial or unverified

#### Scenario: Real dependencies stop at an isolated store
- **WHEN** real capture and generation write only to an isolated test store
- **THEN** the record identifies that boundary and does not claim production publication

#### Scenario: Verification requires unavailable authorization
- **WHEN** the final check requires access or an operation outside current authorization
- **THEN** the author declares the gap without claiming success or bypassing access rules

### Requirement: Review checks completion claims against outcome evidence

Reviewers SHALL compare completion claims with the requested outcome and its evidence.
A success claim supported only by a narrower check, an intermediate state, or a declared gap SHALL be an Important Compliance finding.
An accurate partial result with a declared agent-verification gap SHALL retain the existing review treatment.
This requirement SHALL NOT weaken human hands-on acceptance or release rules.

#### Scenario: A fixture screenshot is presented as completed generation
- **WHEN** the author claims successful generation using a screenshot of simulated preparing or error states
- **THEN** the reviewer reports an Important Compliance finding

#### Scenario: A partial result states its limits
- **WHEN** the record verifies transcript access and explicitly leaves generated article access unverified
- **THEN** the reviewer does not treat that accurate limitation as a false completion claim
