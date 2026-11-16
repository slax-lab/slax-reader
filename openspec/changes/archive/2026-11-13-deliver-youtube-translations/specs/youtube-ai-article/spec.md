# Spec Delta

## MODIFIED Requirements

### Requirement: Shared article versions

The system SHALL keep at most one article per video, caption source hash, target language (`en` or `zh`) and prompt version, and every bookmark of that video SHALL read the version that matches its captions and the reader's language. The system SHALL write a ready article as the body of a bookmark only when the owner has `youtube_article` enabled and reads that language, the bookmark is not flagged by moderation, and the bookmark has no non-deleted highlight or comment. Otherwise the system SHALL NOT change the bookmark's body. A body write SHALL publish the body objects and word count and SHALL keep the player and its cue data. Search indexing SHALL follow as independently retryable work; indexing failure SHALL NOT block reading the ready body or demote the article.

#### Scenario: Second reader with the same language
- **WHEN** a second user saves a video that already has a ready article in that user's AI language
- **THEN** the user reads the same version, the bookmark gets the article body at once, and no new generation starts

#### Scenario: Captions change
- **WHEN** the captions of a video change
- **THEN** the new captions get a new source hash and an article for the old captions is never shown for the new ones

#### Scenario: Bookmark with marks
- **WHEN** an article becomes ready for a bookmark that has a highlight or comment
- **THEN** the body stays the raw transcript and the page shows the article below it

#### Scenario: Skipped by eligibility
- **WHEN** the eligibility rules skip the video
- **THEN** the body stays the raw transcript

### Requirement: Safe publish

A run SHALL write and verify the JSON, HTML and text objects before marking the row `ready` with a compare-and-set on its run id. Source identity, complete ordered cue coverage, nonempty paragraphs and usable target language SHALL gate publication. Numeric and length differences SHALL be recorded as diagnostics and SHALL NOT alone reject a complete translation. A failed version SHALL offer retry to the owner. Optional headings and introductory wording SHALL have deterministic fallbacks and SHALL NOT block a complete body.

#### Scenario: Lost the row to another run
- **WHEN** the compare-and-set fails because another run or new captions changed the row
- **THEN** the run removes its unpublished objects without deleting an already published version and ends without error

#### Scenario: Ambiguous spoken year
- **WHEN** complete translated passages differ in a numeric token such as a source self-correction from 2019 to 2010
- **THEN** the difference is diagnostic and does not force repeated regeneration or reject the article

#### Scenario: Missing translated passage
- **WHEN** a translation response omits a required passage or returns unusable text
- **THEN** successful passages remain saved and only incomplete work is retried within the existing limits

#### Scenario: Independent chunk failure
- **WHEN** one chunk exhausts its recovery allowance
- **THEN** independent chunks continue and save their successful results for a later retry

#### Scenario: Search indexing failure
- **WHEN** indexing fails after a body has been published
- **THEN** the body remains readable and indexing is independently retryable

#### Scenario: Indexing exhausts immediate retries
- **WHEN** indexing remains unavailable after the workflow step retries
- **THEN** the durable publication record remains and a later sweep retries publication and indexing without regenerating the article
