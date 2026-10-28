# Spec Delta

## MODIFIED Requirements

### Requirement: Shared article versions

The system SHALL keep at most one article per video, caption source hash, target language (`en` or `zh`) and prompt version, and legacy unmanaged bookmarks SHALL read the version that matches their captions and the reader's language; new private captures SHALL copy only the first terminal result matching their own pending request, and Forks SHALL retain the body and ready variants copied at creation. The system SHALL write a ready article as the body of a bookmark only when the owner has `youtube_article` enabled and reads that language, the bookmark is not flagged by moderation, and the bookmark has no non-deleted highlight or comment. Otherwise the system SHALL NOT change the bookmark's body. A body write SHALL update the body objects, word count and search index together, and SHALL keep the player and its cue data.

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

Generation SHALL start only for an owner with the `youtube_article` Labs feature enabled, after a save that passed moderation, when the owner opens a bookmark without a version in the owner's AI language, or on the owner's explicit generate or retry. Visitors and frozen Forks SHALL never start generation. A completed private capture SHALL NOT subscribe to another user's save or retry; only its owner's explicit request SHALL open a new private revision. Without the feature, YouTube saves SHALL behave as before and SHALL NOT initiate acquisition. Existing authorized private variants SHALL remain readable; a bookmark without a saved private variant SHALL report `unavailable`.

#### Scenario: Labs feature off
- **WHEN** an owner without `youtube_article` opens a saved YouTube bookmark without a private article variant
- **THEN** the status is `unavailable`, no row is created and nothing starts

#### Scenario: Acquisition disabled after a private article was saved
- **WHEN** an owner disables `youtube_article` after a private article variant was saved
- **THEN** authorized readers retain access to that private variant and no new processing starts

#### Scenario: Visitor opens a shared bookmark
- **WHEN** a visitor opens a shared bookmark whose article is not ready in the visitor's language
- **THEN** the visitor gets the owner's ready version if one exists, and no generation starts

#### Scenario: Skipped by eligibility
- **WHEN** the eligibility rules skip a version for reasons other than length
- **THEN** nothing starts automatically and the owner can choose "generate anyway"

### Requirement: Body status and catch-up

The article status SHALL report `body_mode` (`article` or `transcript`) and `body_ready`, where `body_ready` means the body holds the version this viewer gets. A failed body write SHALL NOT fail the status request. For a legacy unmanaged bookmark, when the owner reads the status of a ready article that is not in the body and the body may change, the system SHALL write it. A managed capture SHALL settle only its own still-pending request with matching source inputs. Completed captures and Forks SHALL read only their private variants with destination-specific version tokens; missing private artifacts SHALL NOT fall back to canonical content. Visitors SHALL NOT cause a write.

#### Scenario: Article made before this change
- **WHEN** the owner opens a bookmark whose ready article is not in the body and that has no marks
- **THEN** the body becomes the article and the status reports `body_mode` `article`

### Requirement: Takedown restores the raw body

Takedown SHALL first establish a video-wide denial barrier for new publication and body/supplement reads, including cached presentations and private copies. It SHALL remove derived content from private sidecars as well as bodies, retaining denial until cleanup succeeds. Takedown SHALL restore the raw caption body of each affected bookmark from its cue data before it deletes the article objects, also for a bookmark flagged by moderation. When the cue data can not be read, takedown SHALL still replace the body with the player only.

#### Scenario: Taken-down video with an article body
- **WHEN** the team takes down a video whose bookmarks show the article body
- **THEN** those bookmarks show the raw captions again and the article objects are gone
