# mobile-library-search Specification

## Purpose
Let Mobile users find their admitted local bookmarks, Collection sources/articles and RSS sources/entries immediately, then enrich saved-article matches with an explicit private cloud search.

## Requirements

### Requirement: Fullscreen search is reachable beside add

The Library SHALL expose an accessible search action beside its add action. Search SHALL open a fullscreen native route containing an input, submit action, tag selector, Collection section, RSS section and article results, using the Mobile profile and existing feature availability. The input SHALL expose a small clear action whenever text or selected conditions are present; activating it SHALL reset both without submitting a search.

#### Scenario: Search opens and returns
- **WHEN** an authenticated user activates the search action
- **THEN** the fullscreen route focuses its input and shows locally available source sections
- **AND** native back returns to the prior Library source and scroll position
- **AND** narrow layouts, Chinese/English text and larger font sizes keep the input and submit action usable

#### Scenario: Clearing the current query
- **WHEN** the input contains text, selected tags, a selected source, or a combination
- **THEN** a small accessible clear action is visible in the input
- **WHEN** the user activates it
- **THEN** the text and all selected conditions are reset and no cloud search is submitted
- **AND** the clear action disappears once the input is empty

#### Scenario: A source is selected without a query
- **WHEN** the user opens Search without text or tags and selects a Collection or RSS source
- **THEN** Search stays open, scopes the local query to that source and returns only its permitted locally available articles
- **AND** empty search does not request all article bodies or cloud results

### Requirement: Typed tags and selected chips share one constraint model

Search SHALL show selected tags in a compact condition row separate from the text editor. A searchable bottom selector and typed `#` suggestions SHALL select the same stable tags. Keywords and selected tags SHALL combine with AND; multiple tags SHALL require every tag. Unknown or ambiguous typed tags MUST NOT silently broaden a submitted query or create tags.

#### Scenario: Keyword and two tags are combined
- **WHEN** the user selects one tag from the selector, commits another through `#` suggestions and types a keyword
- **THEN** article matches satisfy the keyword and both tag constraints
- **AND** removing a selected tag updates local results and invalidates earlier remote results

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
- **AND** Collection and RSS sections are omitted because those sources carry no personal tags
- **AND** a verified saved RSS/Collection article can appear as the personal bookmark

### Requirement: Selected Collection or RSS source scopes local search

Selecting a Collection or RSS subscription in Search SHALL constrain subsequent local searches to that source, replace any selected personal tags, and expose a removable source condition outside the text editor. While a source scope is active, the personal-tag summary SHALL be hidden, and typed `#` options SHALL remain available to switch to personal-tag search. Selecting a personal tag SHALL clear the source scope and hide the Collection/RSS sections. A scoped source query MUST NOT invoke cloud enrichment because cloud Collection/RSS search is not implemented. Clearing the source chip or toggling the source again SHALL restore the unscoped search.

#### Scenario: A source replaces personal tags
- **WHEN** the user has tag chips selected and then selects a Collection or RSS subscription
- **THEN** the tag chips are cleared, the source chip appears, and only that source's local entries are returned
- **AND** selecting a personal tag again clears the source scope

#### Scenario: A scoped source never calls the cloud
- **WHEN** the user submits a query while a Collection or RSS source is selected
- **THEN** only the local source rows are queried
- **AND** no cloud search request is made

### Requirement: Explicit cloud enrichment preserves local usability

A nonempty submitted keyword SHALL trigger a cloud search of the active user's saved titles and bodies with selected tags. Typing alone and tag-only queries MUST NOT invoke cloud search. Local results SHALL remain usable during cloud work and failures; stale query/account/origin responses MUST NOT publish. Cloud failures MUST NOT surface a blocking or retry prompt; only a failure of the local repository may show a local retry. Source titles, including an RSS feed's title/remark/site URL and a Collection's name/description, SHALL remain searchable from local data without cloud enrichment.

#### Scenario: The user edits before a response arrives
- **WHEN** a submitted search is followed by a keyword/tag change or account/origin replacement
- **THEN** the previous remote operation is cancelled or its result discarded
- **AND** the updated local query remains authoritative

#### Scenario: Cloud enrichment fails
- **WHEN** the API fails or the device is offline after submission
- **THEN** local results remain displayed without a blocking or retry prompt
- **AND** the entire page is not replaced by a blocking loading/error screen

#### Scenario: A source title is searched locally
- **WHEN** no personal tag is selected and the keyword matches an RSS feed title/remark/site URL or a Collection name/description
- **THEN** that source appears in its own section without cloud enrichment
- **AND** an RSS hit remains matched when the user's remark differs from the original feed title

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

### Requirement: Search feedback preserves nonempty collapsible groups

Local query preparation and explicit cloud retrieval SHALL expose visible search progress, at the submit control and in an otherwise empty pending-results area. Article group headings MUST NOT display loading indicators. Collection, RSS and article groups SHALL be rendered only when they contain results and SHALL be independently collapsible with accessible expanded state. Collection hits SHALL be listed under their own Collection source and RSS hits under their own RSS subscription; only personal bookmark hits that belong to neither source MAY appear in the article group. Search progress MUST NOT clear useful existing local results during cloud enrichment or produce a premature empty-results message.

#### Scenario: Search is still pending
- **WHEN** a local query or explicit cloud request is pending
- **THEN** the submit area displays loading feedback and a pending-results message is available when no article group is present
- **AND** existing same-query article rows remain usable without an article-heading spinner
- **AND** empty-results feedback waits for the pending search to settle

#### Scenario: A group is empty or collapsed
- **WHEN** a Collection, RSS or article group has no matching results
- **THEN** its heading and content are omitted
- **WHEN** a user toggles a nonempty group heading
- **THEN** only that group collapses or expands and its accessible expanded state follows its visibility

#### Scenario: Collection and RSS hits keep their source category
- **WHEN** local search returns a Collection article or an RSS entry
- **THEN** the row is displayed under that Collection or RSS subscription rather than in the general article group
- **AND** selecting the source row scopes Search to that source
- **AND** an unmatched local row falls back to a named group instead of disappearing

### Requirement: Tag selection is quick and bounded by the available viewport

A trailing `#` or `#prefix` SHALL expose local tag options immediately without a cloud request. Choosing one SHALL consume the typed token and select its stable UUID. The bottom tag selector SHALL remain anchored above the keyboard or at the bottom safe area, with reachable Done/reset controls and an independently scrolling options list.

#### Scenario: A tag is chosen while a source is selected
- **WHEN** a source-scoped user types `#` and selects a suggested personal tag
- **THEN** the source condition is cleared and the tag constrains personal bookmark matches
- **AND** the typed token disappears without submitting a cloud request

#### Scenario: The tag selector has many options and a keyboard
- **WHEN** the tag selector opens on a narrow device and its filter keyboard appears
- **THEN** its viewport-derived panel height avoids clipping or offscreen controls
- **AND** the options can scroll independently of the header and completion action

### Requirement: Article rows present real origin and save-time metadata

All result types SHALL share a consistent virtualized article row with safe text highlights and bounded snippets. A personal result SHALL display its actual host at the lower left and available save time at the lower right, without a repeated generic saved-article label. The personal-article category heading SHALL remain. Nonempty local metadata SHALL take precedence over cloud enrichment, which MAY fill missing fields.

#### Scenario: A modern cloud-only match has metadata
- **WHEN** a search response includes a valid owned UUID, target URL and save time
- **THEN** its row displays the host and time without a per-hit detail request
- **AND** an older response omitting these additive fields remains usable without invented footer metadata

#### Scenario: An unchanged query is submitted again
- **WHEN** the user submits a query whose local rows are already visible
- **THEN** those rows remain visible during the cloud request
- **AND** an actual change to keyword, tags or source invalidates prior remote work
