# Spec Delta

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
- **WHEN** the eligibility rules skip the video
- **THEN** the body stays the raw transcript

## ADDED Requirements

### Requirement: Body status and catch-up

The article status SHALL report `body_mode` (`article` or `transcript`) and `body_ready`. When the owner reads the status of a ready article that is not in the body and the body may change, the system SHALL write it. Visitors SHALL NOT cause a write.

#### Scenario: Article made before this change
- **WHEN** the owner opens a bookmark whose ready article is not in the body and that has no marks
- **THEN** the body becomes the article and the status reports `body_mode` `article`

### Requirement: Takedown restores the raw body

Takedown SHALL restore the raw caption body of each affected bookmark from its cue data before it deletes the article objects.

#### Scenario: Taken-down video with an article body
- **WHEN** the team takes down a video whose bookmarks show the article body
- **THEN** those bookmarks show the raw captions again and the article objects are gone

### Requirement: Body swap on the bookmark page

When the body is the raw transcript and the article is coming, the page SHALL show a status line above the body and SHALL reload the body in place when it is ready, but SHALL NOT replace it while the video plays. Article times SHALL seek the player, and the playing paragraph SHALL be marked.

#### Scenario: Article ready while the video plays
- **WHEN** the body becomes ready while the video plays
- **THEN** the page offers a button to load the article instead of replacing the body
