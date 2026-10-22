# youtube-ai-article Specification

## Purpose
Turn the captions of a saved YouTube video into a faithful written article in the reader's AI language, without changing the saved original.

## Requirements

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
- **WHEN** the eligibility rules skip the video
- **THEN** the body stays the raw transcript

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

The `youtube_article_target_language` migration SHALL NOT drop or rename a table, column or unique key. It SHALL add `target_language` and the language-aware unique key. The P0 unique key `(video_id, source_hash, prompt_version)` is dropped by the `media_article` migration of `podcast-article`, which ships in the same release. Migrations run before the new code deploys, so this code never runs while the P0 key exists, and it writes language rows through the language-aware key only.

#### Scenario: Production code during the beta migration
- **WHEN** beta has applied both migrations and production still runs the P0 code
- **THEN** a YouTube save in production still succeeds; its caption row and ref write fails softly and is logged, and a later save of the bookmark records them

#### Scenario: Second language after the migrations
- **WHEN** an owner in another language opens a video whose caption version already has a row
- **THEN** the system creates the row for that language

### Requirement: Visible Settings row for YouTube AI articles

Web Settings SHALL show the `youtube_article` Labs row together with the `youtube` row when both names are translated, without changing the loaded Labs state or stored preferences.

#### Scenario: Enabled account opens Settings
- **WHEN** an account with `youtube_article` enabled opens Settings
- **THEN** the row is present and enabled, and no preference update is sent

### Requirement: Body status and catch-up

The article status SHALL report `body_mode` (`article` or `transcript`) and `body_ready`, where `body_ready` means the body holds the version this viewer gets. A failed body write SHALL NOT fail the status request. When the owner reads the status of a ready article that is not in the body and the body may change, the system SHALL write it. Visitors SHALL NOT cause a write.

#### Scenario: Article made before this change
- **WHEN** the owner opens a bookmark whose ready article is not in the body and that has no marks
- **THEN** the body becomes the article and the status reports `body_mode` `article`

### Requirement: Takedown restores the raw body

Takedown SHALL restore the raw caption body of each affected bookmark from its cue data before it deletes the article objects, also for a bookmark flagged by moderation. When the cue data can not be read, takedown SHALL still replace the body with the player only.

#### Scenario: Taken-down video with an article body
- **WHEN** the team takes down a video whose bookmarks show the article body
- **THEN** those bookmarks show the raw captions again and the article objects are gone

### Requirement: Body swap on the bookmark page

When the body is the raw transcript and the article is coming, the page SHALL show a status line above the body and SHALL reload the body in place when it is ready, but SHALL NOT replace it while the video plays. Article times SHALL seek the player, and the playing paragraph SHALL be marked.

#### Scenario: Article ready while the video plays
- **WHEN** the body becomes ready while the video plays
- **THEN** the page offers a button to load the article instead of replacing the body
