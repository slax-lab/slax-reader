# podcast-article Specification

## Purpose
Turn a saved podcast episode into a readable transcript article that is the bookmark body, with playback from any paragraph.

## Requirements

### Requirement: Podcast capture behind Labs

For an owner with the `podcast` Labs feature, the system SHALL save a recognised episode link (Xiaoyuzhou, Apple Podcasts, direct audio, RSS feed newest episode, Spotify, Pocket Casts) as a podcast bookmark with a player and show notes. For other owners, and for links that are not an episode, the system SHALL save the link as a normal page. The system SHALL NOT download or store audio.

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

#### Scenario: Audio transcription on the Workers runtime
- **WHEN** an episode has no publisher transcript and the API runs on the Workers runtime
- **THEN** the system submits the audio URL to AssemblyAI instead of failing with an invalid fetch invocation

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

### Requirement: Pocket Casts episode capture

With podcast Labs enabled, the system SHALL recognize Pocket Casts episode links on `pca.st` and `pocketcasts.com`. It SHALL extract the episode audio and metadata through the existing bounded page-fetch process. Show pages and pages without safe episode audio SHALL remain normal pages. The system SHALL NOT download audio during capture.

#### Scenario: Short episode link
- **WHEN** an owner saves `https://pca.st/episode/f7269801-ce3f-48fc-9e57-3783fdbbe7d2` with podcast Labs enabled
- **THEN** the bookmark contains an audio player and episode notes and enters the existing transcription process

#### Scenario: Canonical episode link
- **WHEN** the owner saves the corresponding canonical Pocket Casts episode page
- **THEN** the same audio URL produces the same episode source identity

#### Scenario: Unsafe audio
- **WHEN** an episode page supplies a private, credential-bearing, or non-HTTP audio URL
- **THEN** the system does not send that URL to transcription or a player

#### Scenario: Supported publisher transcript
- **WHEN** the page advertises a timed transcript in a supported format
- **THEN** the existing publisher-transcript process precedes paid transcription

#### Scenario: HTML transcript page
- **WHEN** the page only links to an HTML transcript viewer
- **THEN** the system does not treat that HTML link as timed transcript data

### Requirement: Explicit recovery of Pocket Casts page captures

An owner SHALL be able to save an existing Pocket Casts source URL again to request podcast capture. The system SHALL retain the bookmark identity. It SHALL refuse to replace an existing annotated body during Pocket Casts recapture. Visitors SHALL NOT start recovery.

#### Scenario: Existing unannotated page
- **WHEN** the owner saves a Pocket Casts URL previously captured as episode notes
- **THEN** the existing save flow requests podcast capture for that owner's bookmark

#### Scenario: Existing annotated page
- **WHEN** a Pocket Casts recapture finds highlights or comments on the existing body
- **THEN** capture ends without a page fetch, keeps the body and annotations, and leaves the bookmark readable

### Requirement: Annotated podcast recapture

When an owner saves a recognized podcast link again with podcast Labs enabled, the system SHALL check for highlights and comments on the existing body before it fetches the page. An annotated body SHALL be kept. This SHALL apply to every recognized podcast source.

#### Scenario: Annotated page capture of a non-Pocket Casts episode
- **WHEN** an owner saves a Xiaoyuzhou, Apple Podcasts, Spotify, or RSS episode link again, and its existing body has highlights or comments
- **THEN** capture ends without a page fetch, keeps the body and annotations, and leaves the bookmark readable

#### Scenario: Unannotated recapture
- **WHEN** the existing body has no highlights or comments
- **THEN** the system captures the episode as usual

#### Scenario: Labs disabled
- **WHEN** podcast Labs is disabled for the owner
- **THEN** the system saves the link as a page and does not check annotations

### Requirement: Pocket Casts short-code resolution

The system SHALL resolve public `pca.st` share redirects before deciding whether a link identifies a podcast episode.
For a resolved episode and an owner with podcast Labs enabled, capture SHALL use the existing podcast capture process.
The system SHALL preserve outbound URL validation, episode identity, and annotation protection.
Show links and unresolved short codes SHALL retain normal page handling.

#### Scenario: Reported short-code episode
- **WHEN** an owner with podcast Labs enabled saves `https://pca.st/6rpkp8cj` and it redirects to its canonical episode page
- **THEN** the bookmark receives the episode player and notes through podcast capture
- **AND** the existing transcription process receives the episode

#### Scenario: Same episode through different links
- **WHEN** the short-code link and the canonical episode link resolve to the same episode audio
- **THEN** both captures use the same episode source identity

#### Scenario: Show destination
- **WHEN** a `pca.st` share link redirects to a show page
- **THEN** the system handles it as a normal page without starting podcast transcription

#### Scenario: Labs disabled
- **WHEN** an owner without podcast Labs saves a short-code episode link
- **THEN** the system handles it as a normal page without starting podcast transcription

#### Scenario: Resolution unavailable
- **WHEN** short-code resolution fails or returns no redirect destination
- **THEN** the system retains normal page handling for the original link
- **AND** the unresolved short code does not qualify as an episode

#### Scenario: Unsafe redirect destination
- **WHEN** a short-code response redirects to a destination rejected by outbound URL validation
- **THEN** the system does not fetch the rejected destination or start transcription from it

#### Scenario: Existing annotated bookmark
- **WHEN** an owner requests recapture of a short-code episode bookmark with an existing annotated body
- **THEN** the system preserves the body and annotations without fetching the episode page

#### Scenario: Existing unannotated bookmark
- **WHEN** an owner with podcast Labs requests recapture of an unannotated short-code episode bookmark
- **THEN** podcast capture retains the bookmark identity

### Requirement: Concurrent readable podcast articles

The system SHALL edit complete podcast transcripts into readable articles through the existing article workflow.
It SHALL process at most five editing or translation chunks concurrently and assemble them in source order.
It SHALL retain cue references, quality checks, retry reuse, and the episode cost limit.

#### Scenario: Independent chunks
- **WHEN** an article requires multiple chunks
- **THEN** up to five model requests can run together without waiting for earlier generated text
- **AND** the final article follows source order and retains transcript coverage

#### Scenario: Concurrent cost admission
- **WHEN** model requests overlap
- **THEN** admission includes settled costs and active reservations
- **AND** a request waits for reservations or fails before spending beyond the available budget

#### Scenario: Failed chunk
- **WHEN** a chunk fails while sibling chunks are active
- **THEN** the workflow waits for the active siblings before ending the attempt
- **AND** a retry reuses successfully stored chunks

#### Scenario: Accounting failure
- **WHEN** a model cost cannot be recorded
- **THEN** the workflow admits no further model requests in that attempt

### Requirement: Complete podcast reading presentation

The Web reader SHALL present complete generated podcast articles with the YouTube reading hierarchy and styles.
It SHALL show an introduction, contents, topic headings, and chapter playback controls without visible timestamps on every paragraph.
Original and translated articles SHALL retain ordered text and playback references.

#### Scenario: Complete article
- **WHEN** podcast article generation succeeds
- **THEN** the page displays the complete article with introduction, contents, and topic sections
- **AND** each chapter playback control seeks to its source time

#### Scenario: Contents navigation
- **WHEN** the reader selects a contents entry
- **THEN** the reader scrolls to that topic within the current article

#### Scenario: Preserved paragraph references
- **WHEN** the reading presentation hides paragraph timestamps
- **THEN** paragraph cue and timing metadata remain available for playback and annotations
