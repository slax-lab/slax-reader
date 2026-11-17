## ADDED Requirements

### Requirement: Publisher exemption from capture quality validation

Reader SHALL skip post-capture content quality validation for a save by an account whose user ID exactly matches a trimmed entry in the configured publisher allowlist.

#### Scenario: Publisher saves an otherwise eligible article

- **WHEN** an allowlisted account saves an article that would normally trigger quality validation
- **THEN** the capture proceeds without scheduling a quality check, generating its screenshot, or sending its validation result card

#### Scenario: Other account saves an otherwise eligible article

- **WHEN** the saving account has no matching allowlist entry, including when the allowlist is empty
- **THEN** Reader schedules the usual quality validation for that save
