# Spec Delta

## Purpose

Turn a saved podcast episode into a readable transcript article that is the bookmark body, with playback from any paragraph.

## ADDED Requirements

### Requirement: Podcast capture behind Labs

For an owner with the `podcast` Labs feature, the system SHALL save a recognised episode link (Xiaoyuzhou, Apple Podcasts, direct audio, RSS feed newest episode, Spotify) as a podcast bookmark with a player and show notes. For other owners, and for links that are not an episode, the system SHALL save the link as a normal page. The system SHALL NOT download or store audio.

#### Scenario: Labs feature off
- **WHEN** an owner without `podcast` saves a Xiaoyuzhou episode link
- **THEN** the link saves as a normal page and nothing podcast-specific runs

#### Scenario: Feed without audio
- **WHEN** an owner with `podcast` saves a feed that has no audio enclosure
- **THEN** the link saves as a normal page

#### Scenario: Error that will repeat
- **WHEN** the episode source answers with a blocked address, a 4xx status, a body above the size cap or an unreadable answer
- **THEN** the link saves as a normal page without further retries

### Requirement: Transcript source and billing

The system SHALL use a publisher transcript when one exists, and SHALL otherwise transcribe the audio URL with AssemblyAI. A retried step SHALL NOT start a second paid transcription for the same episode.

#### Scenario: Publisher transcript
- **WHEN** the feed item has a VTT, SRT, Podcasting 2.0 JSON or timed text transcript
- **THEN** the system uses it and does not call AssemblyAI

#### Scenario: Retry that polls a counted job
- **WHEN** a later attempt polls a finished job whose cost was already counted
- **THEN** the episode cost and the site-wide spend do not change

#### Scenario: Retry after a stored job
- **WHEN** a workflow step retries after the provider job id was stored
- **THEN** the step polls the stored job and does not submit a new one

### Requirement: Shared article as the body

The system SHALL keep one transcript and one original-language article per episode, shared by every bookmark of the episode, and SHALL write the article as the body of each such bookmark with its word count. Every paragraph SHALL keep its start time. The article SHALL NOT summarise or add facts.

#### Scenario: Second save of the same episode
- **WHEN** a second user saves an episode whose article is ready
- **THEN** the bookmark gets the article body at once and no new cost is spent

### Requirement: Translation

For a reader whose AI language differs from the episode language, the system SHALL provide a paragraph-by-paragraph translation that maps to the original paragraphs, and the page SHALL let the reader switch between them.

#### Scenario: Visitor in another language
- **WHEN** a share visitor whose language differs opens a ready episode
- **THEN** the visitor can read the translation for that language when it is ready

### Requirement: Bounded cost

The system SHALL stop spending on an episode above $1, SHALL start at most 5 new episodes per user per UTC day, SHALL stop new work when site-wide spend reaches $30 in a UTC day, and SHALL skip episodes longer than 3 hours.

#### Scenario: Sixth new episode of the day
- **WHEN** an owner saves the sixth new episode in one UTC day
- **THEN** it does not start, the status is `limit_reached` and the owner can retry later

### Requirement: Same access rule as the snapshot

The podcast status and translation endpoints SHALL apply the snapshot read rule of `BookmarkService.getBookmarkReadAccess`. Only the owner SHALL retry. A visitor SHALL see a running episode as pending and a failed episode as unavailable, without failure detail.

#### Scenario: Share turned off
- **WHEN** the owner turns off the share of a podcast bookmark
- **THEN** a visitor gets not found for status and translation

### Requirement: Media article migration compatible with deployed code

The migration SHALL NOT rename or drop tables or columns. It SHALL add `media_kind` with default `youtube`, the media article version key and the podcast episode table. It SHALL drop the P0 unique key `(video_id, source_hash, prompt_version)`; only the P0 code writes through that key, and it does so in a step that never fails the save.

#### Scenario: Production code during the beta migration
- **WHEN** beta has applied the migration and production runs `youtube-ai-article` or the P0 code
- **THEN** `youtube-ai-article` reads and writes YouTube article rows as before, and a P0 save still succeeds while its caption row write fails softly

#### Scenario: Several languages after the contract step
- **WHEN** an owner in another language opens a video whose caption version already has a row
- **THEN** the system creates the row for that language

### Requirement: Playback on the bookmark page

The bookmark page SHALL show a sticky audio player for podcast bookmarks, SHALL offer "listen from here" on timed paragraphs and on a selection, and SHALL show transcribing, failed and limit states above the body without changing the article DOM.

#### Scenario: Listen from a paragraph
- **WHEN** the reader chooses "listen from here" on a paragraph
- **THEN** the player seeks to the paragraph's start time and plays
