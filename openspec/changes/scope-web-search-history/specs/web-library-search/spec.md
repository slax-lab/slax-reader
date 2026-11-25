## ADDED Requirements

### Requirement: Keep recent searches private to the active account

The Web experience SHALL restore history for the verified current account and clear the visible list immediately on identity changes.

#### Scenario: Shared browser

- **WHEN** account A searches for a term, signs out and account B focuses an empty search box
- **THEN** B sees none of A's terms

#### Scenario: Switch back and clear

- **WHEN** A signs back in, clears recent searches and later returns to the same browser
- **THEN** A's saved terms are gone and B's history is unchanged

#### Scenario: Legacy profile

- **WHEN** a profile has only the old unscoped history key when first used after the change
- **THEN** its terms are not assigned to any account or shown while identity is unresolved
