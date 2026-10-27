## ADDED Requirements

### Requirement: Visible status request recovery

Both YouTube article presentations SHALL show a request failure after polling exhausts its retries. The reader SHALL be able to restart status polling without starting a paid generation request directly.

#### Scenario: First status request never succeeds
- **WHEN** every initial status request fails
- **THEN** the page shows a request error and a retry button instead of hiding the status area

#### Scenario: Status recovers
- **WHEN** the reader retries and the status request succeeds
- **THEN** the request error disappears and the current article state appears

#### Scenario: Expanded article transition
- **WHEN** the status selects the expanded article below an annotated transcript
- **THEN** the page mounts that view without a rendering error and keeps request recovery available

### Requirement: Owner-only unavailable guidance

The status API SHALL distinguish disabled Labs and missing source records for an authorized owner. The Web reader SHALL show instructions for enabling Labs or saving the source again. Visitors SHALL NOT receive owner recovery reasons. Moderation and takedown states SHALL NOT suggest recovery that bypasses access restrictions. Ready private snapshots SHALL remain readable with Labs disabled.

#### Scenario: Owner has disabled Labs
- **WHEN** an owner opens a legacy YouTube bookmark with AI articles disabled
- **THEN** the page explains how to enable YouTube AI articles in Settings

#### Scenario: Missing caption reference
- **WHEN** an owner with AI articles enabled opens a legacy bookmark without source records
- **THEN** the page explains that the source must be saved again

#### Scenario: Visitor opens an unavailable article
- **WHEN** a visitor opens the same bookmark
- **THEN** no owner recovery reason or action is disclosed
