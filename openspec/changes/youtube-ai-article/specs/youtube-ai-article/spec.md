# Spec Delta

## Purpose

Turn the captions of a saved YouTube video into a faithful written article in the reader's AI language, without changing the saved original.

## ADDED Requirements

### Requirement: Shared article versions

The system SHALL keep at most one article per video, caption source hash, target language (`en` or `zh`) and prompt version, and every bookmark of that video SHALL read the version that matches its captions and the reader's language. The system SHALL NOT change the bookmark's original body HTML, plain text, status, marks or search content.

#### Scenario: Second reader with the same language
- **WHEN** a second user saves a video that already has a ready article in that user's AI language
- **THEN** the user reads the same version and no new generation starts

#### Scenario: Captions change
- **WHEN** the captions of a video change
- **THEN** the new captions get a new source hash and an article for the old captions is never shown for the new ones

### Requirement: Generation triggers and Labs gate

Generation SHALL start only for an owner with the `youtube_article` Labs feature enabled, after a save that passed moderation, when the owner opens a bookmark without a version in the owner's AI language, or on the owner's explicit generate or retry. Visitors SHALL never start generation. Without the feature, YouTube saves SHALL behave as before and the article status SHALL be `unavailable`.

#### Scenario: Labs feature off
- **WHEN** an owner without `youtube_article` opens a saved YouTube bookmark
- **THEN** the status is `unavailable`, no row is created and nothing starts

#### Scenario: Visitor opens a shared bookmark
- **WHEN** a visitor opens a shared bookmark whose article is not ready in the visitor's language
- **THEN** the visitor gets the owner's ready version if one exists, and no generation starts

#### Scenario: Skipped by eligibility
- **WHEN** the eligibility rules skip a version for reasons other than length
- **THEN** nothing starts automatically and the owner can choose "generate anyway"

### Requirement: Bounded cost

The system SHALL stop spending on an article version above $0.30 across all attempts, SHALL allow at most 20 automatic and 5 manual starts per user per UTC day, and SHALL defer new runs and send one alert per day when site-wide spend reaches $20 in a UTC day.

#### Scenario: Daily automatic limit
- **WHEN** an owner triggers the 21st automatic start in one UTC day
- **THEN** the status is `limit_reached` and nothing starts

#### Scenario: Save-triggered start over the limit
- **WHEN** an owner saves a video after 20 automatic starts in the same UTC day
- **THEN** nothing starts and the version stays pending

#### Scenario: Site-wide budget
- **WHEN** site-wide spend for the day reaches the budget
- **THEN** new runs are deferred for the sweep and exactly one alert is sent that day

### Requirement: Same access rule as the snapshot

The article status and content endpoints SHALL apply the snapshot read rule of `BookmarkService.getBookmarkReadAccess`. Only the owner SHALL generate or retry. A bookmark flagged by moderation SHALL show no article, also to the owner.

#### Scenario: Share turned off
- **WHEN** the owner turns off the share of a bookmark
- **THEN** a visitor gets not found for the article, and the owner still reads it

#### Scenario: Unknown or guessed version
- **WHEN** a request names a version of another video, a guessed version or a version that is not ready
- **THEN** the content endpoint answers not found

### Requirement: Safe publish

A run SHALL write the JSON, HTML and text objects and read them back before it marks the row `ready` with a compare-and-set on its run id. Validation failures (cue references, language, number coverage, length ratio, duplicate or empty blocks) SHALL mark the version `failed` and SHALL NOT publish it. A failed version SHALL offer retry to the owner.

#### Scenario: Lost the row to another run
- **WHEN** the compare-and-set fails because another run or new captions changed the row
- **THEN** the run deletes the objects it wrote and ends without error

### Requirement: Sweep and takedown

A sweep on the existing 5-minute schedule SHALL return dead runs to pending or failed, start deferred requests, delete versions that no bookmark references for 7 days, and remove taken-down videos.

#### Scenario: Dead run
- **WHEN** a running row's lease expires
- **THEN** the sweep retries it or marks it failed by its retry count

### Requirement: Article on the bookmark page

The bookmark page SHALL show the article below the player, outside the original article DOM, with generating, ready, skipped, failed, limit-reached and slow states. The client SHALL render article text with text bindings only. When the article is ready and the bookmark has no marks, the page SHALL fold the original transcript and offer to show it. Chapter times SHALL seek the player. Status changes SHALL be announced through a persistent live region.

#### Scenario: Markup in model output
- **WHEN** an article paragraph contains HTML
- **THEN** the page shows it as text and runs nothing

#### Scenario: Bookmark with marks
- **WHEN** the article is ready and the bookmark has marks on the transcript
- **THEN** the transcript stays unfolded so comment cards can scroll to their marks

### Requirement: Migration compatible with deployed code

The migration SHALL NOT drop or rename a table, column or unique key that the deployed code writes through. It SHALL keep the unique key `(video_id, source_hash, prompt_version)` until a later contract migration. While that key exists, the system SHALL keep one language row per caption version and SHALL answer `unavailable` for another language instead of failing.

#### Scenario: Production code during the beta migration
- **WHEN** beta has applied the migration and production still runs the P0 code
- **THEN** the P0 caption write succeeds as before

#### Scenario: Second language before the contract migration
- **WHEN** an owner in another language opens a video whose caption version already has a row
- **THEN** the status is `unavailable` and the request does not fail

### Requirement: Hidden Settings row for YouTube AI articles

Web Settings SHALL omit the `youtube_article` Labs row while the `youtube` row is hidden, without changing the loaded Labs state or stored preferences.

#### Scenario: Enabled account opens Settings
- **WHEN** an account with `youtube_article` enabled opens Settings
- **THEN** the row is absent, the feature stays enabled and no preference update is sent
