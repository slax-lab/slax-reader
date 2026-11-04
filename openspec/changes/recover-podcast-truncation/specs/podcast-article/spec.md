## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Concurrent readable podcast articles

The system SHALL edit complete podcast transcripts through the existing article workflow, retaining source order, cue references, quality checks, retry reuse and the episode cost limit. It SHALL use ten rolling workers with at most ten active model calls, replacing the earlier five-call podcast bound. Admission SHALL still include settled costs plus active reservations and SHALL hold calls back when the unchanged budget does not fit. A failed chunk SHALL stop new scheduling while already-running work is awaited.

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

#### Scenario: Accounting failure
- **WHEN** a model cost cannot be recorded
- **THEN** the workflow admits no further model requests in that attempt
