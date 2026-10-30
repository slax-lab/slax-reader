## ADDED Requirements

### Requirement: Completion evidence follows the requested outcome

Verification SHALL trace back to the original user request and reported input, in addition to the proposal and delta-spec scenarios.
The record SHALL distinguish the requested outcome from narrower component checks.
A scope reduction SHALL identify the user instruction that authorizes it.
The author SHALL NOT claim completion for an outcome supported only by component checks, intermediate states, or a declared verification gap.

#### Scenario: Component checks pass while the requested outcome remains unverified
- **WHEN** component checks pass with substituted responses
- **THEN** the evidence verifies only those components
- **AND** the author does not claim the requested outcome succeeded

#### Scenario: The user narrows the immediate target
- **WHEN** the user names a narrower immediate target
- **THEN** the evidence records that instruction and verifies the narrower target
- **AND** the record keeps the original outcome separate

### Requirement: Evidence separates outcome results from dependency substitutions

Each requested outcome SHALL carry one result of verified, partial, or unverified, with its limits stated.
The record SHALL identify which dependencies were real and which were substituted.
When the requested outcome is a final user-visible state that a background process produces, the evidence SHALL confirm that state through an independent read path, not only the process result.
When the record presents a screenshot or a read of shared content as evidence, it SHALL state whether the state shown is real or substituted, and which reader role made the read.
These requirements SHALL NOT authorize additional access, paid operations, or production changes.

#### Scenario: A completed process has no readable result
- **WHEN** a background process finishes but the intended reader cannot retrieve its saved result
- **THEN** the requested readable-output outcome remains partial or unverified

#### Scenario: Real dependencies stop at an isolated store
- **WHEN** real processing writes only to an isolated test store
- **THEN** the record identifies that boundary and does not claim production publication

#### Scenario: Verification requires unavailable authorization
- **WHEN** the final check requires access or an operation outside current authorization
- **THEN** the author declares the gap without claiming success or bypassing access rules

### Requirement: Review checks completion claims against outcome evidence

Reviewers SHALL compare completion claims with the requested outcome and its evidence.
A success claim supported only by a narrower check, an intermediate state, or a declared gap SHALL be an Important Compliance finding.
An accurate partial result with a declared agent-verification gap SHALL retain the existing review treatment.
This requirement SHALL NOT weaken human hands-on acceptance or release rules.

#### Scenario: A substituted state is presented as the completed outcome
- **WHEN** the author claims the requested outcome using evidence of a substituted or intermediate state
- **THEN** the reviewer reports an Important Compliance finding

#### Scenario: A partial result states its limits
- **WHEN** the record verifies one outcome and explicitly leaves another unverified with its reason
- **THEN** the reviewer does not treat that accurate limitation as a false completion claim
