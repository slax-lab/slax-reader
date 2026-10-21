# Spec Delta

## Purpose

Let Mobile users find their admitted local bookmarks, Collection sources/articles and RSS sources/entries immediately, then enrich saved-article matches with an explicit private cloud search.

## ADDED Requirements

### Requirement: Fullscreen search is reachable beside add

The Library SHALL expose an accessible search action beside its add action. Search SHALL open a fullscreen native route containing an input, submit action, horizontal tag rail, Collection section, RSS section and article results, using the Mobile profile and existing feature availability.

#### Scenario: Search opens and returns
- **WHEN** an authenticated user activates the search action
- **THEN** the fullscreen route focuses its input and shows locally available source sections
- **AND** native back returns to the prior Library source and scroll position
- **AND** narrow layouts, Chinese/English text and larger font sizes keep the input and submit action usable

#### Scenario: A source is selected without a query
- **WHEN** the user opens Search without text or tags and selects a Collection or RSS source
- **THEN** the existing Library source opens with its permission and availability rules
- **AND** empty search does not request all article bodies or cloud results

### Requirement: Typed tags and selected chips share one constraint model

The search input SHALL support removable tag chips alongside free text. The rail and typed `#` suggestions SHALL select the same stable tags. Keywords and selected tags SHALL combine with AND; multiple tags SHALL require every tag. Unknown or ambiguous typed tags MUST NOT silently broaden a submitted query or create tags.

#### Scenario: Keyword and two tags are combined
- **WHEN** the user selects one tag from the rail, commits another through `#` suggestions and types a keyword
- **THEN** article matches satisfy the keyword and both tag constraints
- **AND** removing a chip updates local results and invalidates earlier remote results

#### Scenario: IME Enter confirms composition
- **WHEN** Enter confirms an active Chinese input composition
- **THEN** it does not submit a cloud search
- **AND** a later noncomposing Enter and the submit button invoke the same search behavior

#### Scenario: A tag has no unambiguous local identity
- **WHEN** an unknown, ambiguous or deleted tag remains in the input at submit
- **THEN** the user receives editable resolution feedback
- **AND** the client does not submit an unconstrained substitute search

### Requirement: Local search covers stored metadata independently of Inbox rendering

Typing SHALL search admitted nondeleted personal bookmarks across Inbox, Starred and Archived, permitted local Collection metadata/articles and available locally synchronized RSS metadata. Search SHALL include titles/aliases, descriptions/summaries and relevant URL/site/source names, with bounded pages and literal handling of query punctuation.

#### Scenario: The match is not in the rendered Inbox window
- **WHEN** a saved or archived article outside the currently rendered Library viewport matches local text
- **THEN** Search can return it without opening or downloading its body
- **AND** scrolling local result pages can reach later matches

#### Scenario: Search is used offline
- **WHEN** an admitted account searches without connectivity
- **THEN** matching local rows remain navigable without a network wait
- **AND** uncached RSS history and unavailable Collection content are not represented as locally searchable

#### Scenario: Personal tags constrain RSS and Collection matches
- **WHEN** a personal tag is selected
- **THEN** article results contain only matching owned saved bookmarks carrying that tag
- **AND** source sections explain that personal tags do not filter unsaved RSS or Collection content
- **AND** a verified saved RSS/Collection article can appear as the personal bookmark

### Requirement: Explicit cloud enrichment preserves local usability

A nonempty submitted keyword SHALL trigger a cloud search of the active user's saved titles and bodies with selected tags. Typing alone and tag-only queries MUST NOT invoke cloud search. Local results SHALL remain usable during cloud work and failures; stale query/account/origin responses MUST NOT publish.

#### Scenario: The user edits before a response arrives
- **WHEN** a submitted search is followed by a keyword/tag change or account/origin replacement
- **THEN** the previous remote operation is cancelled or its result discarded
- **AND** the updated local query remains authoritative

#### Scenario: Cloud enrichment fails
- **WHEN** the API fails or the device is offline after submission
- **THEN** local results remain displayed with a localized inline retry state
- **AND** the entire page is not replaced by a blocking loading/error screen

### Requirement: Merged hits retain identity and Reader context

Local and remote personal hits SHALL merge by verified saved-bookmark identity without duplicate rows. Local metadata SHALL remain authoritative when available, enriched snippets SHALL be safely rendered, and remote-only hits SHALL be openable. Distinct Collection and RSS permission contexts MUST NOT be merged by URL alone.

#### Scenario: Cloud returns an existing and a not-yet-synced bookmark
- **WHEN** remote enrichment contains one locally matched user UUID and one valid remote-only saved article
- **THEN** the existing row gains its match snippet in place and the remote-only row is appended in backend rank order
- **AND** each opens the correct personal Reader without waiting for a full sync

#### Scenario: The user opens another result type
- **WHEN** a Collection article or RSS entry is selected
- **THEN** Reader receives its existing Collection owner/access or RSS entry context
- **AND** returning restores the same search query, chips, results and scroll position

#### Scenario: A local tag edit has not synced
- **WHEN** a cloud response still includes a bookmark whose selected tag was locally removed
- **THEN** the merged result honors the current local tag constraint
- **AND** stale remote membership does not restore the removed match
