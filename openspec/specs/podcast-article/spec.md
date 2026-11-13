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

The system SHALL edit complete podcast transcripts through the existing article workflow, retaining source order, cue references, quality checks, retry reuse and the episode cost limit. It SHALL use ten rolling workers with at most ten active model calls, replacing the earlier five-call podcast bound. Admission SHALL still include settled costs plus active reservations and SHALL hold calls back when the unchanged budget does not fit. A failed chunk SHALL stop new scheduling while already-running work is awaited.

#### Scenario: Independent chunks
- **WHEN** an article requires multiple chunks
- **THEN** up to ten model requests can run together without waiting for earlier generated text
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

#### Scenario: An episode fits within the worker pool
- **WHEN** an episode has at most ten chunks and sufficient budget for their reservations
- **THEN** all chunks can start without an artificial five-chunk batch boundary
- **AND** insufficient budget still limits simultaneous provider calls

#### Scenario: One slow chunk does not block later chunks
- **WHEN** an earlier chunk remains slow while another worker completes and more chunks remain
- **THEN** the available worker starts the next chunk without waiting for a batch boundary
- **AND** active calls remain at most ten and final assembly preserves source order

#### Scenario: A worker fails with siblings still running
- **WHEN** a chunk fails
- **THEN** no new top-level chunk is scheduled after that failure is observed
- **AND** in-flight siblings settle before the first failure is propagated

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

### Requirement: Semantic podcast polish output

The podcast polish response schema SHALL exclude integer-typed properties, including document version and section timestamps. The assembled article SHALL derive timestamps from original cue references and supply its document version locally.

#### Scenario: Polish request contains no integer generation fields
- **WHEN** the system submits a podcast polish request
- **THEN** no property anywhere in its response schema is INTEGER-typed
- **AND** a response without version or timestamp fields can produce an article with correct source-derived timestamps

### Requirement: Proactive podcast generation sizing

The system SHALL size podcast editing and translation requests from serialized input and output headroom before model invocation, preserving source-unit identities, order and complete input coverage. The requested output limit SHALL be the lesser of 65,536 tokens and four times estimated user-input tokens plus 8,192 tokens of headroom. Admission SHALL reserve that requested limit, not an unrelated ceiling or smaller usage estimate.

#### Scenario: Metadata makes a request exceed its planned size
- **WHEN** transcript text fits the nominal chunk size but serialized cue metadata increases the estimate beyond the planned request size
- **THEN** the system divides it into smaller source-aligned requests before generation
- **AND** every owned cue remains represented exactly once in the assembled input plan

#### Scenario: Proportional output cap
- **WHEN** a smaller request needs less than the 65,536-token ceiling after expansion and headroom
- **THEN** the requested output limit scales with that input instead of defaulting to 65,536
- **AND** input growth never raises the limit above 65,536
- **AND** reservation and unknown-usage accounting use the actual requested limit

### Requirement: Recover truncated podcast generation

The system SHALL bisect splittable input after output truncation or local generation timeout, retain completed work and assemble results in source order without publishing partial output. Indivisible input SHALL receive at most three generation tries per chunk-step invocation before retryable exhaustion. Existing episode and daily spending limits SHALL apply throughout recovery.

#### Scenario: Editing response is truncated
- **WHEN** a splittable podcast editing request ends at its output-token limit
- **THEN** the failed range is divided and generated as smaller ranges
- **AND** the article retains cue references without duplicating contextual overlap or introduction text

#### Scenario: Translation response is truncated
- **WHEN** a splittable translation request ends at its output-token limit
- **THEN** smaller requests retain original translation-unit identifiers
- **AND** the translation matches the original paragraph ordering and completeness

#### Scenario: Generation stalls before reaching its output cap
- **WHEN** a splittable generation request hits its local timeout
- **THEN** its abort signal cancels the request and recovery persists a binary split
- **AND** later attempts do not resend that unchanged timed-out parent

#### Scenario: Resume after a partial recovery
- **WHEN** one child succeeds and another fails transiently
- **THEN** a later attempt reuses the successful child and established split
- **AND** it does not regenerate the unchanged known-truncated parent

#### Scenario: Whole-chunk cache predates recovery support
- **WHEN** a valid whole-chunk cache exists from an earlier attempt
- **THEN** the system reuses it without model calls despite new internal partitioning

#### Scenario: Indivisible input exhausts its bounded tries
- **WHEN** a singleton still stalls or truncates after three tries and no resource boundary has intervened
- **THEN** it yields retryable singleton_incomplete:stall or singleton_incomplete:runaway respectively
- **AND** normal workflow and article retry limits apply
- **AND** no persistent singleton failure marker blocks a later permitted retry or invalidates completed siblings

#### Scenario: No further safe recovery
- **WHEN** the permitted cost, call count or total attempt deadline is exhausted
- **THEN** recovery stops with a diagnosable failure
- **AND** incomplete output is not published as ready

#### Scenario: Provider rejects a request
- **WHEN** the provider returns an explicit HTTP rejection without a generated response
- **THEN** the system releases the reservation without inventing output charges or splitting the input
- **AND** normal retry handling applies

### Requirement: Podcast short-backchannel duplicate handling

Podcast polish and translation quality checks SHALL accept exact trimmed repeats shorter than 40 characters when the copies share no source cue ID. Repeats of at least 40 characters or repeats sharing a cue SHALL still fail duplicate checks. YouTube's default exact-repeat behavior SHALL remain unchanged.

#### Scenario: Short backchannel at distant cues
- **WHEN** a short backchannel such as Yeah. occurs at distinct source cues in an otherwise valid podcast article
- **THEN** duplicate detection does not reject the article or its translation merely for that repeat

#### Scenario: Short repeat shares a source cue
- **WHEN** copies of the same short text share any source cue ID
- **THEN** duplicate detection rejects the repeated content

#### Scenario: Long repeat or unchanged YouTube defaults
- **WHEN** a podcast repeat has at least 40 trimmed characters or a YouTube article uses the default quality options
- **THEN** exact repeated paragraphs remain duplicate failures

### Requirement: Podcast paragraph cue ownership

Polish output SHALL exclude context-only overlap cue references. Overlap-only paragraphs SHALL be dropped; mixed paragraphs SHALL retain only their owned cue IDs so their source-derived starts do not move backward into the previous chunk. Distinct paragraphs MAY share an owned cue. Paragraph start cues SHALL be nondecreasing within and across sections, with equal starts allowed for shared cues.

#### Scenario: Mixed context and owned references
- **WHEN** a generated paragraph references both contextual overlap and owned cues
- **THEN** the paragraph retains its owned IDs and loses the contextual IDs
- **AND** its start time comes from an owned cue rather than the earlier context

#### Scenario: Paragraphs are reversed within one section
- **WHEN** a later paragraph starts before an earlier paragraph in the same section
- **THEN** part-level and final checks reject the output as a cue-reference failure
- **AND** distinct paragraphs sharing the same starting cue remain valid

### Requirement: Part-level podcast quality admission

A polish part SHALL pass quality checks against its own source cues before being cached. Number coverage SHALL be exempt for fewer than five distinct source numbers, and length ratio SHALL be exempt for fewer than 400 non-whitespace source characters. The first part of the first polish chunk SHALL contain a nonempty introduction before caching. Later parts MAY leave the introduction empty. Other checks SHALL remain active. A rejected part SHALL fail retryably without discarding successful siblings.

#### Scenario: One generated child fails quality
- **WHEN** one child succeeds and another contains a quality defect
- **THEN** a retry regenerates only the rejected child and reuses the successful child and known split
- **AND** rejected output is not cached as success or published

#### Scenario: Small source sample
- **WHEN** the owned source contains fewer than five distinct numbers or fewer than 400 non-whitespace characters
- **THEN** the corresponding number or length check does not reject the part solely for that small sample
- **AND** invalid cue references, empty content and other quality failures are still rejected

#### Scenario: Hallucinated cue reference
- **WHEN** a part names a cue outside its owned source
- **THEN** the part fails cue-reference validation retryably before caching

#### Scenario: Missing introduction
- **WHEN** the first polish part has an empty introduction
- **THEN** only that uncached part retries while successful siblings remain reusable

### Requirement: Bounded assembled podcast repair

An assembled quality failure SHALL allow at most one repair pass before terminal assembled failure. Polish repair SHALL target defective chunks, including the first chunk when a legacy cached introduction is empty and later chunks containing long paragraphs copied from earlier chunks; when no chunk is identifiable, all chunks SHALL be redone. Translation repair SHALL redo all translation chunks. Only selected chunks and their child caches SHALL be invalidated. Revalidation SHALL run afresh without replaying earlier workflow step results.

#### Scenario: Later chunk repeats a long paragraph
- **WHEN** otherwise valid chunks fail assembly because a later chunk repeats an earlier paragraph of at least 40 trimmed characters
- **THEN** repair regenerates the later offending chunk while preserving unaffected caches
- **AND** successful reassembly can publish

#### Scenario: Untargetable global quality failure
- **WHEN** assembly fails but no individual polish chunk is identified
- **THEN** all polish chunks are regenerated once and assembly runs again

#### Scenario: Translation quality failure
- **WHEN** the assembled translation fails quality
- **THEN** all translation chunks are regenerated once without regenerating the ready original article

#### Scenario: Cached workflow step results
- **WHEN** a repair is executed in a workflow that caches successful step results
- **THEN** repair chunk generation and assembly use fresh step identities
- **AND** neither operation replays the earlier pass instead of doing repair work

#### Scenario: Repair does not resolve quality
- **WHEN** the one repair pass still produces an assembled quality failure
- **THEN** the attempt fails and its chunk caches are cleared
- **AND** no second repair or partial ready publication occurs

### Requirement: Podcast Chinese magnitude equivalence

Podcast polish and translation number coverage SHALL recognize article values expressed as N 万 or N 亿 as equivalent to N×10,000 or N×100,000,000. The coverage threshold SHALL remain unchanged. YouTube's default number matching SHALL remain unchanged unless this option is explicitly enabled.

#### Scenario: Chinese translation uses magnitude words
- **WHEN** source numbers 50,000 and 80,000 appear in a translation as 5 万 and 8 万
- **THEN** both values count as covered without requiring a literal five-digit rendering

#### Scenario: Hundred-million magnitude and default compatibility
- **WHEN** a podcast article uses 1 亿 for 100,000,000
- **THEN** its number coverage recognizes the equivalent value
- **AND** default YouTube checks do not acquire this opt-in equivalence

### Requirement: Generation without business caps

The system SHALL process otherwise eligible podcast episodes without rejecting or deferring them because of media duration, total text length, total chunk count, estimated cost, accumulated per-run or lifetime cost, site daily spend, or user daily starts. Cost accounting SHALL continue. Provider request deadlines, finite retry and repair attempts, concurrency controls, leases, access rules, moderation, and validation SHALL remain enforced.

#### Scenario: Work exceeds former caps
- **WHEN** otherwise eligible work exceeds any former cap (3 hours, 80 chunks, $1 per episode, $30 per day, or 5 new episodes per user per day)
- **THEN** those values do not prevent generation or interrupt accepted work

#### Scenario: Owner retries a cap rejection
- **WHEN** an authorized owner explicitly requests generation or retry of work previously skipped or failed solely because of a removed length or budget cap
- **THEN** the work can be queued again with accumulated spend preserved
- **AND** historical records are not automatically bulk-requeued

#### Scenario: Provider stalls or concurrency is full
- **WHEN** a provider request stalls or available workflow concurrency is exhausted
- **THEN** request deadlines and existing deferred-start behavior still apply

#### Scenario: Sixth new episode of the day
- **WHEN** an owner saves the sixth otherwise eligible new episode in one UTC day
- **THEN** the former daily quota does not prevent the workflow from starting

### Requirement: Accept nonempty model content

Polishing and translation SHALL accept nonempty model content without numeric, length, language, duplication, speaker-name, cue-coverage or cue-order quality gates. Such properties SHALL NOT trigger regeneration, source substitution or publication failure. Transcript admission SHALL reject only empty speech content, not low speech density. Generation SHALL retain empty-output checks and executable protocol requirements, including parseable responses and translation item mapping. Provider failures, truncation, missing stored chunks and failed writes SHALL remain recoverable execution errors. Diagnostic logs SHALL contain identifiers, counts and error codes rather than transcript or response bodies.

#### Scenario: Nonempty content previously rejected by quality scoring
- **WHEN** a parseable nonempty polish or translation result changes numeric representation, length, language, repeated wording, speaker labels or source references
- **THEN** the system accepts it without content-driven retries and publishes after all required output objects are written

#### Scenario: Empty output
- **WHEN** a generated paragraph or required translation item is empty or missing
- **THEN** the system does not publish an empty article and uses bounded recovery

#### Scenario: Execution error
- **WHEN** the provider truncates the response or a required object cannot be read back after writing
- **THEN** the system does not mark the incomplete article ready
