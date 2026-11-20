## MODIFIED Requirements

### Requirement: Safe Source and Fork attribution

The reader SHALL preserve its original Source presentation and add a Fork marker for Forked bookmarks. In Reader Web, the existing Source treatment and Fork attribution SHALL occupy one row when both are present. Fork attribution SHALL say who the copy was saved from when identity is available and display a distinct, localized link to the authorized Reader snapshot. A public source link SHALL be shown only after authorizing both the destination and the exact source for the current viewer. Source-owner identity SHALL additionally obey the source's user-information visibility setting. Missing or inaccessible sources SHALL show a neutral unavailable label while the copied article remains readable. Viewer-specific source identity SHALL NOT enter shared HTML caches or another account's client state.

#### Scenario: Forked article with an accessible original publication and Reader snapshot

- **WHEN** a reader opens a Forked bookmark with the original publication and an authorized Reader snapshot available
- **THEN** Source and the localized Fork attribution appear side by side
- **AND** selecting Source opens the original publication under its existing rules and selecting Fork attribution opens the immediate Reader snapshot

#### Scenario: Long metadata at a narrow width

- **WHEN** a Forked detail is viewed at a 320px Web viewport with a long publication, author, filename, or source-owner name
- **THEN** the row fits on one line without horizontal overflow and truncates long values while preserving identifiable labels and the full accessible name of each available link

#### Scenario: Ordinary article

- **WHEN** the displayed bookmark has no Fork provenance
- **THEN** Source retains its existing content, placement, appearance, and behavior

#### Scenario: Pending attribution

- **WHEN** a bookmark is marked as Forked and viewer-specific attribution has not loaded
- **THEN** a generic, noninteractive attribution is displayed without identity or a snapshot link

#### Scenario: Readable source with hidden owner identity
- **WHEN** the source is readable but its share hides user information from the viewer
- **THEN** Fork attribution uses a generic label and at most the permitted snapshot link, with no owner name, avatar or profile information

#### Scenario: Public copy with private source
- **WHEN** a source owner visits someone else's public Fork and later an anonymous viewer visits it
- **THEN** the anonymous viewer receives no privileged source name or link from the earlier visit's cached HTML

#### Scenario: Source sharing is revoked
- **WHEN** source access is revoked after copying
- **THEN** a fresh attribution request returns an unavailable marker while destination content remains accessible under its own policy

#### Scenario: Uploaded PDF attribution
- **WHEN** a Forked uploaded PDF is displayed
- **THEN** Source remains the local-upload filename presentation and Fork separately identifies the authorized Reader source without exposing a synthetic file URL
