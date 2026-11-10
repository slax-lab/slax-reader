## MODIFIED Requirements

### Requirement: Shared article versions

The system SHALL keep at most one article per video, caption source hash, target language (`en` or `zh`) and prompt version, and every bookmark of that video SHALL read the version that matches its captions and the reader's language. The system SHALL write a ready article as the body of a bookmark only when the owner has `youtube_article` enabled and reads that language, the bookmark is not flagged by moderation, and the bookmark has no non-deleted highlight or comment. Otherwise the system SHALL NOT change the bookmark's body. A body write SHALL update the body objects, word count and search index together, and SHALL keep the player and its cue data.

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
- **WHEN** the video has no nonempty captions
- **THEN** no article is generated and the existing body is retained

### Requirement: Generation triggers and Labs gate

Generation SHALL start only for an owner with the `youtube_article` Labs feature enabled, after a save that passed moderation, when the owner opens a bookmark without a version in the owner's AI language, or on the owner's explicit generate or retry. Visitors SHALL never start generation. Without the feature, YouTube saves SHALL behave as before and the article status SHALL be `unavailable`.

#### Scenario: Labs feature off
- **WHEN** an owner without `youtube_article` opens a saved YouTube bookmark
- **THEN** the status is `unavailable`, no row is created and nothing starts

#### Scenario: Visitor opens a shared bookmark
- **WHEN** a visitor opens a shared bookmark whose article is not ready in the visitor's language
- **THEN** the visitor gets the owner's ready version if one exists, and no generation starts

#### Scenario: Skipped by eligibility
- **WHEN** an authorized generation trigger has nonempty captions
- **THEN** generation is not skipped or held for review based on duration, text length, language, title, speech density, noise, repetition or readability scores

### Requirement: Safe publish

A run SHALL write the JSON, HTML and text objects and read them back before it marks the row `ready` with a compare-and-set on its run id. Empty required output SHALL NOT be published. Nonempty output SHALL NOT be rejected, replaced or regenerated based on cue references, language, number coverage, length ratio, duplicated wording, source wording or refusal-phrase matching. Parse errors, missing required output and provider truncation SHALL retain bounded recovery. A failed version SHALL offer retry to the owner.

#### Scenario: Lost the row to another run
- **WHEN** the compare-and-set fails because another run or new captions changed the row
- **THEN** the run deletes the objects it wrote and ends without error

#### Scenario: Nonempty output accepted once
- **WHEN** a parseable response supplies all required nonempty passages with changed wording, numbers, language, length or repeated text
- **THEN** the returned text is accepted without content-driven repair or source substitution

#### Scenario: Empty output remains invalid
- **WHEN** required generated content is empty
- **THEN** the system recovers within bounded retries and never publishes an empty article

