# Spec Delta

## MODIFIED Requirements

### Requirement: Shared article as the body

The system SHALL keep one transcript and one original-language article per episode, reused as a computation cache. Legacy unmanaged bookmarks SHALL retain shared publication. New private captures SHALL pin episode inputs and saved player metadata, copy the first matching terminal result of their own pending request, and retain it independently thereafter. Forks SHALL copy the currently readable body and ready variants and SHALL NOT subscribe to later source updates. Every published body SHALL include its word count. Every paragraph SHALL keep its start time. The article SHALL NOT summarise or add facts.

#### Scenario: Second save of the same episode
- **WHEN** a second user saves an episode whose article is ready
- **THEN** the bookmark gets the article body at once and no new cost is spent

### Requirement: Translation

For a reader whose AI language differs from the episode language, the system SHALL provide a paragraph-by-paragraph translation that maps to the original paragraphs, and the page SHALL let the reader switch between them. Managed captures SHALL expose only their privately stored variants; frozen Forks SHALL include only translations ready at creation, with resolved paragraph times. Absent or unfinished variants on a Fork SHALL be terminally unavailable and SHALL NOT trigger generation or perpetual polling. Private versions SHALL have destination-specific revision tokens, and missing private artifacts SHALL NOT fall back to live canonical content.

#### Scenario: Visitor in another language
- **WHEN** a share visitor whose language differs opens a ready episode
- **THEN** the visitor can read the translation for that language when it is ready

### Requirement: Same access rule as the snapshot

The podcast status and translation endpoints SHALL apply the snapshot read rule of `BookmarkService.getBookmarkReadAccess`. Only the owner of an ordinary capture SHALL retry; a frozen Fork SHALL NOT start work. Moderation SHALL continue to reach private copies and their supplemental content. A canonical input refresh or reference-hash update SHALL NOT repoint a completed private capture or Fork. For legacy unmanaged bookmarks or a managed capture's matching pending request, a visitor SHALL see running work as pending and failed work as unavailable, without failure detail. Completed captures and frozen Forks SHALL derive status only from their private sidecar.

#### Scenario: Source generation continues after Fork
- **WHEN** a Fork is created while a supplemental article or translation is unfinished and the canonical episode later runs again
- **THEN** the Fork's absent variant remains terminally unavailable and its visitor status does not become pending

#### Scenario: Share turned off
- **WHEN** the owner turns off the share of a podcast bookmark
- **THEN** a visitor gets not found for status and translation
