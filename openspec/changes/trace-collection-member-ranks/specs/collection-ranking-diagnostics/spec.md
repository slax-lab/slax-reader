## ADDED Requirements

### Requirement: Internal testers can compare member ranking decisions for one impression

The existing Collection endpoint SHALL run the comparison only on explicit request by an authenticated internal tester. It SHALL preserve the served recommendation response and correlate comparison records to its impression ID.

#### Scenario: Trace an eligible Collection request

- **WHEN** an allowlisted authenticated viewer requests a Collection rank trace
- **THEN** the service records baseline and alternate Collection positions and member UUID orders from the same recalled shortlist
- **AND** the alternative, age-neutral and subscription-preference member orders use the same timestamp and eligible members
- **AND** the records identify the preference source and scalar signal values while keeping raw vectors, titles and URLs out of comparison properties.

#### Scenario: Visibility changes during vector readback

- **WHEN** a candidate loses sharing eligibility during the comparison
- **THEN** the alternate candidate scores and orders omit the withdrawn member.

#### Scenario: No diagnostic is authorized or requested

- **WHEN** the request lacks the preference, the viewer is outside the allowlist, or the request is for articles
- **THEN** the service performs no comparison work and emits the ordinary served event.

#### Scenario: Comparison completion

- **WHEN** comparison computation completes, has an empty baseline or fails
- **THEN** a correlated marker distinguishes the outcome and gives the expected number of Collection records
- **AND** a comparison failure preserves the served response.
