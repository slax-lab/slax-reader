# youtube-ai-article Specification

## Purpose
Turn the captions of a saved YouTube video into a faithful written article in the reader's AI language, without changing the saved original.

## Requirements

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

### Requirement: Same access rule as the snapshot

The article status and content endpoints SHALL apply the snapshot read rule of `BookmarkService.getBookmarkReadAccess`. Only the owner SHALL generate or retry. A bookmark flagged by moderation SHALL show no article, also to the owner.

#### Scenario: Share turned off
- **WHEN** the owner turns off the share of a bookmark
- **THEN** a visitor gets not found for the article, and the owner still reads it

#### Scenario: Unknown or guessed version
- **WHEN** a request names a version of another video, a guessed version or a version that is not ready
- **THEN** the content endpoint answers not found

### Requirement: Safe publish

A run SHALL write the JSON, HTML and text objects and read them back before it marks the row `ready` with a compare-and-set on its run id. Empty required output SHALL NOT be published. Nonempty output SHALL NOT be rejected, replaced or regenerated based on cue references, language, number coverage, length ratio, duplicated wording, source wording or refusal-phrase matching. Parse errors, missing required output and provider truncation SHALL retain bounded recovery. A failed version SHALL offer retry to the owner.

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

#### Scenario: Nonempty output accepted once
- **WHEN** a parseable response supplies all required nonempty passages with changed wording, numbers, language, length or repeated text
- **THEN** the returned text is accepted without content-driven repair or source substitution

#### Scenario: Empty output remains invalid
- **WHEN** required generated content is empty
- **THEN** the system recovers within bounded retries and never publishes an empty article

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

### Requirement: Visible status request recovery

Both YouTube article presentations SHALL show a request failure after polling exhausts its retries. The reader SHALL be able to restart status polling without starting a paid generation request directly.

#### Scenario: First status request never succeeds
- **WHEN** every initial status request fails
- **THEN** the page shows a request error and a retry button instead of hiding the status area

#### Scenario: Status recovers
- **WHEN** the reader retries and the status request succeeds
- **THEN** the request error disappears and the current article state appears

#### Scenario: Expanded article transition
- **WHEN** the status selects the expanded article below an annotated transcript
- **THEN** the page mounts that view without a rendering error and keeps request recovery available

### Requirement: Owner-only unavailable guidance

The status API SHALL distinguish disabled Labs and missing source records for an authorized owner. The Web reader SHALL show instructions for enabling Labs or saving the source again. Visitors SHALL NOT receive owner recovery reasons. Moderation and takedown states SHALL NOT suggest recovery that bypasses access restrictions. Ready private snapshots SHALL remain readable with Labs disabled.

#### Scenario: Owner has disabled Labs
- **WHEN** an owner opens a legacy YouTube bookmark with AI articles disabled
- **THEN** the page explains how to enable YouTube AI articles in Settings

#### Scenario: Missing caption reference
- **WHEN** an owner with AI articles enabled opens a legacy bookmark without source records
- **THEN** the page explains that the source must be saved again

#### Scenario: Visitor opens an unavailable article
- **WHEN** a visitor opens the same bookmark
- **THEN** no owner recovery reason or action is disclosed

#### Scenario: Preferred language has no saved variant
- **WHEN** another saved language exists but the owner's preferred language has no variant
- **THEN** the API does not report that the source is missing
- **AND** the API reports the ready article in the language it has, so the reader can open it

#### Scenario: Unknown recovery reason
- **WHEN** the server returns a reason the Web reader does not recognize
- **THEN** the reader does not display a raw translation key

### Requirement: Readable transcript without generation

The Web reader SHALL present saved YouTube caption cues as continuous reading paragraphs for owners and visitors.
Paragraph breaks SHALL follow sentence endings, explicit speaker changes, or long pauses, with bounded length for unpunctuated runs.
Each reading paragraph SHALL expose one quiet, keyboard-operable timestamp. Intermediate timestamps SHALL leave the focus order.
The renderer SHALL preserve all cue text, existing cue elements, and stored highlight selectors and offsets.
The detailed transcript panel SHALL retain all cue timestamps. Raw-caption formatting SHALL NOT rewrite generated article content.

#### Scenario: Visitor reads the reported saved transcript
- **WHEN** a visitor opens a saved YouTube body without a generated article
- **THEN** the reader shows continuous paragraphs instead of a separate visible line and button for every cue
- **AND** the page does not require login or a generation request

#### Scenario: Existing highlight and seek controls
- **WHEN** the reader formats a previously saved caption body
- **THEN** the original text nodes and highlight selectors remain valid
- **AND** each paragraph timestamp seeks to its original cue time by click, Enter, or Space

#### Scenario: Responsive transcript reading
- **WHEN** the same transcript appears at narrow and desktop widths in each supported theme
- **THEN** paragraphs wrap naturally, retain visible focus, and avoid horizontal overflow

### Requirement: Faithful edited YouTube reading

New YouTube articles SHALL edit the source before translation. They SHALL preserve meaningful source content and chronological order.
Each paragraph SHALL retain source cue references. Translation SHALL preserve section and paragraph structure.
The introduction SHALL use the complete article. Caption reference coverage SHALL be checked before publication.
The reading page SHALL provide contents links, topic headings, readable paragraphs, playback controls, and method notes.
Existing annotations SHALL remain valid. All Web themes and supported widths SHALL remain readable.

#### Scenario: Source passage omitted
- **WHEN** an edited article omits source cue references
- **THEN** generation rejects the incomplete article before publication

#### Scenario: Translated article
- **WHEN** the requested language differs from the source
- **THEN** translation uses the edited source and preserves its section, paragraph, and source reference structure

#### Scenario: Complete introduction
- **WHEN** the system generates the introduction
- **THEN** the input includes every final article section

#### Scenario: Navigation and playback
- **WHEN** a reader opens an edited article
- **THEN** contents links reach the matching headings and playback controls seek to their source time

#### Scenario: Published article with generation disabled
- **WHEN** an authorized reader opens an existing ready article with Labs disabled
- **THEN** the article remains readable without initiating generation

#### Scenario: Body publication failure
- **WHEN** canonical generation succeeds but body publication fails
- **THEN** the canonical article remains available and the runner reports incomplete publication

### Requirement: Bounded concurrent article generation

The system SHALL process independent transcript chunks concurrently with at most five active chunks per article run.
It SHALL preserve source order, complete cue coverage, existing article access rules, and validation before publication.
Chunk context SHALL remain deterministic and SHALL NOT depend on another chunk's completion order.

#### Scenario: Multiple chunks are ready
- **WHEN** an article has at least five uncached chunks and sufficient budget
- **THEN** five chunks can start before any of those chunks completes
- **AND** no sixth chunk runs concurrently with them

#### Scenario: Results complete in another order
- **WHEN** later chunks finish before earlier chunks
- **THEN** the published article keeps source order and covers every source cue exactly once

#### Scenario: Translation follows editing
- **WHEN** the target language differs from the transcript language
- **THEN** each translation uses its own completed edit
- **AND** another chunk can proceed without waiting for that translation

### Requirement: Concurrent failure and budget safety

The system SHALL include active model-call reservations when it checks the run and lifetime spending limits.
It SHALL settle active work before finishing a failed run and SHALL retain successful chunk results for retry.
It SHALL NOT publish incomplete results or reset spending because processing becomes concurrent.

#### Scenario: Active calls reserve the remaining budget
- **WHEN** another call's reservation temporarily consumes the remaining budget
- **THEN** a waiting call rechecks the budget after settlement
- **AND** it does not spend against the same unreserved balance

#### Scenario: One chunk fails
- **WHEN** a chunk exhausts its retries while sibling chunks remain active
- **THEN** the run waits for those siblings before recording its final outcome
- **AND** it starts no later batch and preserves completed chunk caches

#### Scenario: A workflow resumes
- **WHEN** execution resumes with completed durable steps and stored chunk results
- **THEN** those completed calls are not charged or generated again
- **AND** new calls account for persisted spend and active reservations

#### Scenario: Existing article is ready
- **WHEN** a reader opens an existing ready article after deployment
- **THEN** the system retains that article without regeneration

### Requirement: Edited article typography is isolated from generic content resets

The Web reader SHALL retain the dedicated edited-YouTube-article typography, alignment, and vertical rhythm when the complete application stylesheet is loaded. Paragraphs SHALL retain the existing 18px sans-serif reading size and 1.85 line-height ratio through nested sections. Contents labels SHALL retain their compact 14px sans-serif presentation and start alignment rather than justified text. Topic headings, paragraphs, introduction labels, timestamps, and method notes SHALL retain the dedicated hierarchy and spacing rather than generic article defaults.

#### Scenario: Saved edited article renders inside the normal reader
- **WHEN** a reader opens a bookmark whose saved body contains an edited YouTube article
- **THEN** nested paragraphs render at the dedicated reading line height, with zero top margin and the existing bottom spacing
- **AND** contents labels do not acquire generic serif typography, enlarged body text, or stretched justification spaces
- **AND** chapter spacing follows the dedicated reading rhythm rather than generic first-child and paragraph spacing rules

#### Scenario: Separate edited article renders below an annotated transcript
- **WHEN** existing marks require the generated article to render separately below the original transcript
- **THEN** its corresponding reading elements retain the same typography roles and rhythm as the saved-body presentation
- **AND** neither presentation depends on a preferred font being installed to avoid clipping or overlap

#### Scenario: Supported themes and widths
- **WHEN** the edited article is displayed in light, dark, or e-ink at narrow and desktop widths
- **THEN** paragraphs and contents wrap without clipping, overlap, or horizontal document overflow
- **AND** contents links and seek controls retain visible keyboard focus and their existing target sizes

### Requirement: Edited article seeking uses chapter controls without paragraph indicators

Both edited YouTube body presentations SHALL show a 12px accent-colored seek button beside each timed chapter heading, using `m:ss` or `h:mm:ss` labels and the existing `slax:youtube-seek` event bridge. Saved-body controls SHALL derive their time from the existing heading's `data-start-ms`. Paragraph timestamp nodes SHALL remain in the saved DOM but SHALL be invisible and excluded from keyboard focus and accessibility output. Paragraphs SHALL NOT acquire playback backgrounds, accent edges, or follow-along scrolling in this presentation.

#### Scenario: Reader seeks to a chapter
- **WHEN** a reader clicks a chapter control or activates it with Enter or Space
- **THEN** exactly one YouTube seek event carries the chapter start in whole seconds
- **AND** the control provides visible focus and a target at least 44px wide and tall
- **AND** the expanded component's existing native chapter control continues to work

#### Scenario: Saved article is processed repeatedly and removed
- **WHEN** chapter adaptation runs repeatedly on the same live body
- **THEN** there is exactly one added control per timed heading and no duplicate chapter listeners
- **WHEN** the processor is cleaned up
- **THEN** the added controls and their listeners are removed while the original paragraph timestamp attributes remain unchanged
- **AND** processing the body again installs one working set of chapter controls

#### Scenario: Video playback advances through paragraphs
- **WHEN** playback time updates occur while an edited YouTube body is displayed
- **THEN** paragraphs remain visually quiet with no playback background or left edge
- **AND** hidden paragraph timestamps cannot be reached by keyboard and do not trigger paragraph-follow scrolling

### Requirement: Edited article styling has no unrelated presentation effects

The correction SHALL affect only the edited YouTube article body. It SHALL preserve existing paragraph elements, descendant text nodes, heading text nodes and IDs, annotation selectors, timestamp attributes, and contents navigation. Adding chapter-control nodes is permitted; moving or replacing existing content is not. Ordinary articles, raw YouTube transcripts, podcast articles, the player (including its maximum width), the sidebar, and the application shell SHALL retain their existing behavior and presentation.

#### Scenario: Existing article interaction
- **WHEN** a reader uses contents links, chapter controls, or existing annotations after the correction
- **THEN** contents anchors, text ranges, paragraph identities, and stored annotation targets remain valid
- **AND** chapter seeking works without rewriting saved HTML or regenerating content

#### Scenario: Another content type is displayed
- **WHEN** a reader opens an ordinary article, raw-caption body, or podcast article
- **THEN** the edited-YouTube correction does not change that content's computed typography, spacing, controls, or playback behavior

### Requirement: Generation without business caps

The system SHALL process otherwise eligible YouTube articles without rejecting or deferring them because of media duration, total text length, total chunk count, estimated cost, accumulated per-run or lifetime cost, site daily spend, or user daily starts. Cost accounting SHALL continue. Provider request deadlines, finite retry and repair attempts, concurrency controls, leases, access rules, moderation, and validation SHALL remain enforced.

#### Scenario: Work exceeds former caps
- **WHEN** otherwise eligible work exceeds any former cap (6 hours, 400,000 characters, 40 chunks, $1 per run, $2 lifetime, $20 per day, or 20 automatic / 5 manual starts per user per day)
- **THEN** those values do not prevent generation or interrupt accepted work

#### Scenario: Owner retries a cap rejection
- **WHEN** an authorized owner explicitly requests generation or retry of work previously skipped or failed solely because of a removed length or budget cap
- **THEN** the work can be queued again with accumulated spend preserved
- **AND** historical records are not automatically bulk-requeued

#### Scenario: Provider stalls or concurrency is full
- **WHEN** a provider request stalls or available workflow concurrency is exhausted
- **THEN** request deadlines and existing deferred-start behavior still apply

#### Scenario: Daily automatic limit
- **WHEN** an owner triggers the 21st otherwise eligible automatic start in a UTC day
- **THEN** generation starts without returning `limit_reached` because of that count

#### Scenario: Save-triggered start over the limit
- **WHEN** an owner saves an otherwise eligible video after 20 automatic starts that day
- **THEN** the former daily quota does not prevent its workflow from starting

#### Scenario: Site-wide budget
- **WHEN** recorded site-wide spend exceeds the former daily budget
- **THEN** generation continues without a budget deferral or a budget-pause alert

#### Scenario: Long video automatic admission
- **WHEN** a video longer than four hours meets the remaining language, speech-density, and readability rules
- **THEN** it is eligible for automatic generation and duration alone does not send it to manual review
