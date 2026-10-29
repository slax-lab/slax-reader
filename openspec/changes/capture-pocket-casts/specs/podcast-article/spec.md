## ADDED Requirements

### Requirement: Pocket Casts episode capture

With podcast Labs enabled, the system SHALL recognize Pocket Casts episode links on `pca.st` and `pocketcasts.com`. It SHALL extract the episode audio and metadata through the existing bounded page-fetch process. Show pages and pages without safe episode audio SHALL remain normal pages. The system SHALL NOT download audio during capture.

#### Scenario: Short episode link
- **WHEN** an owner saves `https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2` with podcast Labs enabled
- **THEN** the bookmark contains an audio player and episode notes and enters the existing transcription process

#### Scenario: Canonical episode link
- **WHEN** the owner saves the corresponding canonical Pocket Casts episode page
- **THEN** the same audio URL produces the same episode source identity

#### Scenario: Unsafe audio
- **WHEN** an episode page supplies a private, credential-bearing, or non-HTTP audio URL
- **THEN** the system does not send that URL to transcription or a player

#### Scenario: Supported publisher transcript
- **WHEN** the page advertises a timed transcript in a supported format
- **THEN** the existing publisher-transcript process precedes paid transcription

#### Scenario: HTML transcript page
- **WHEN** the page only links to an HTML transcript viewer
- **THEN** the system does not treat that HTML link as timed transcript data

### Requirement: Explicit recovery of Pocket Casts page captures

An owner SHALL be able to save an existing Pocket Casts source URL again to request podcast capture. The system SHALL retain the bookmark identity. It SHALL refuse to replace an existing annotated body during Pocket Casts recapture. Visitors SHALL NOT start recovery.

#### Scenario: Existing unannotated page
- **WHEN** the owner saves a Pocket Casts URL previously captured as episode notes
- **THEN** the existing save flow requests podcast capture for that owner's bookmark

#### Scenario: Existing annotated page
- **WHEN** a Pocket Casts recapture finds highlights or comments on the existing body
- **THEN** capture ends without a page fetch, keeps the body and annotations, and leaves the bookmark readable
