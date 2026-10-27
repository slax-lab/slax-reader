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

#### Scenario: Preferred language has no saved variant
- **WHEN** another saved language exists but the owner's preferred language has no variant
- **THEN** the API does not report that the source is missing

#### Scenario: Unknown recovery reason
- **WHEN** the server returns a reason the Web reader does not recognize
- **THEN** the reader does not display a raw translation key

### Requirement: Readable transcript without generation

The Web reader SHALL present saved YouTube caption cues as continuous reading paragraphs for owners and visitors.
Paragraph breaks SHALL follow sentence endings, explicit speaker changes, or long pauses, with bounded length for unpunctuated runs.
Each reading paragraph SHALL expose one quiet, keyboard-operable timestamp. Intermediate timestamps SHALL leave the focus order.
The renderer SHALL preserve all cue text, existing cue elements, and stored highlight selectors and offsets.
The detailed transcript panel SHALL retain all cue timestamps. Existing generated article bodies SHALL remain unchanged.

#### Scenario: Visitor reads the reported saved transcript
- **WHEN** a visitor opens a saved YouTube body without a generated article
- **THEN** the reader shows continuous paragraphs instead of a separate visible line and button for every cue
- **AND** the page does not require login or a generation request

#### Scenario: Existing highlight and seek controls
- **WHEN** the reader formats a previously saved caption body
- **THEN** the original text nodes and highlight selectors remain valid
- **AND** each paragraph timestamp seeks to its original cue time by click, Enter, or Space

#### Scenario: Responsive transcript reading
- **WHEN** the same transcript appears at narrow and desktop widths in each supported theme
- **THEN** paragraphs wrap naturally, retain visible focus, and avoid horizontal overflow
