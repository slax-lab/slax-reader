## ADDED Requirements

### Requirement: Clarify what the tag confirmation button counts

The Web experience SHALL label the idle action Done and label pending additions with their count. Keep existing tags visibly attached.

#### Scenario: Reopen an edited article

- **WHEN** an article already has a tag and its editor is reopened
- **THEN** the attached tag is marked and the confirmation control says Done without a zero count

#### Scenario: Select two additions

- **WHEN** the reader selects two more tags and confirms
- **THEN** the control describes two additions and reopening shows all three attached

#### Scenario: Failed write

- **WHEN** the addition fails while the editor is open
- **THEN** the pending selections remain visible and retryable
