# Design

## Context

See proposal.md for scope and approval. A real local run of the 569-cue, approximately 86-minute episode isolated an integer-schema digit loop: 8 of 22 model calls ran away, with repetition ratio 1.0, approximately 1.15 characters per token, and a period-one, all-digit tail. Runaway calls took 33–236 seconds versus an 11-second normal median. Raising temperature to 1.0 alone did not fix it.

After removing unused integer fields there were no runaway calls: 13 polish calls (median 11 seconds, maximum 19 seconds) and 8 Chinese translation calls (median 25 seconds), with article and translation ready 132 seconds after transcript availability. ASR took 41 seconds; add_url returned in 188 milliseconds. A later quality failure on the short backchannel at distinct cues c0057 and c0243 exposed a separate false-positive duplicate check.

After the chunk-stability changes, four consecutive clean local runs created through the API completed all 89 model calls normally: 54 polish calls (median 12 s, p90 19 s, maximum 24 s) and 35 translation calls (median 19 s, p90 25 s, maximum 29 s), with no truncation, timeout, rejected part or repair pass. Articles had 30 to 33 sections and no backward paragraph step. These runs do not exercise the recovery paths; validation.md holds the per-run detail.

## Goals / Non-Goals

Prevent the observed schema-driven runaway and keep bounded recovery for intermittent failures, preserving source references, cached work and spending limits. Do not change YouTube generation behavior, reset cost ledgers, repair remote rows, redesign UI, or substitute fixtures for live capture evidence.

## Decisions

### Request only semantic polish fields

Use PODCAST_POLISH_RESPONSE_SCHEMA without any INTEGER-typed properties. Remove schema_version, start_ms and end_ms from model output: the parser already accepts missing section times and assembly derives times from original cue IDs and supplies the document version. The unused integer fields were the observed digit-loop trigger. Retain temperature 1.0 and LOW thinking as Gemini 3 alignment, not as the demonstrated root-cause fix. Translation keeps its original unit identifiers.

### Proportional output and proactive planning

Keep stable approximately 3,000-token top-level chunks and whole-chunk cache keys. Partition uncached requests using actual serialized cue metadata or translation units, system prompt and schema overhead. Request `min(65,536, estimatedUserTokens * 4 + 8,192)` output tokens: 65,536 is a ceiling, not a universal request size.

The fixed-maximum experiment prolonged already-looping replies instead of improving them. A 65,536-token allowance is 16 times a 4,096-token stopping point; at the same generation rate it permits 16 times as much looping before the cap. This describes token exposure, not an assertion that every measured call lasted exactly 16 times longer. Proportional caps contain that exposure; schema removal addresses the trigger. Cost admission reserves the actual requested outputLimit, including full serialized input, never a smaller estimate while requesting a larger cap.

### Resumable recovery safety net

Discard truncated replies. For a splittable range, MAX_TOKENS or a local generation timeout persists a token-weighted binary split and runs left then right. Cache successful children under source-and-prompt hashes, retaining known splits across retries without reissuing failed parents. Only the first original part may supply a lede. Drop overlap-only paragraphs and remove contextual overlap IDs from mixed paragraphs, so retained start times belong to the part's own cues rather than stepping backward across a chunk boundary. Preserve original cue identities/timestamps and translation IDs. Multiple paragraphs may legitimately reference the same owned cue; do not impose one-output-paragraph-per-cue uniqueness.

An indivisible range gets at most three generation tries per chunk-step invocation, each subject to admission and deadlines. Exhaustion raises retryable `singleton_incomplete:stall` or `singleton_incomplete:runaway`; normal workflow/article retry limits still apply. Do not persist a singleton failure lock; remove legacy null-split markers so later attempts can reuse successful siblings and retry only unfinished work. Explicit HTTP rejections and other transient transport failures retain normal retry handling rather than triggering binary splitting.

### Part gates and bounded quality repair

Before caching a polish response, run article quality checks on its sections against its own cues using podcast options and the actual introduction for the first part. Later parts use a placeholder introduction because they do not own it. Paragraph cue starts must be nondecreasing, including within each section, while equal starts remain valid. Skip number_coverage for fewer than five distinct source numbers, and length_ratio for fewer than 400 non-whitespace source characters. All other checks, including invalid cue references, remain active. Reject with retryable `chunk_quality:<checks>` and count-only part_rejected diagnostics. The next step attempt regenerates only the uncached bad part, retaining completed siblings and known splits.

If assembly fails, allow one repair pass. For polish, select chunks failing the part checks (including a first chunk with an empty cached introduction) and later chunks holding long paragraph text repeated from an earlier chunk. If no specific chunk is identified, redo all; translation always redoes all its chunks. Delete only selected whole-chunk keys and their inner-part caches, rerun them and reassemble. Repair steps use distinct `-r1` names for both chunk execution and assembly so workflow result caching cannot replay the earlier pass. Persistent assembled failure drops all chunks and ends failed; no second repair pass or partial publication is allowed. The existing missing-object error path remains an error, not fabricated article content.

### Rolling execution and accounting

Use ten rolling workers, not five or fixed batches. Episodes with at most ten chunks can schedule all chunks immediately, subject to cost admission; longer episodes refill available workers. This explicitly supersedes the earlier merged/sibling five-call podcast bound without changing YouTube concurrency. Child calls remain sequential within a worker. On the first failed chunk, stop scheduling new chunks, await every in-flight worker and propagate that first failure. Partial output never becomes ready.

Keep the $1 episode limit, the existing $30 daily job-start gate, lease guards and fail-closed model-call accounting. The existing ASR path marks its database cost before updating the daily Redis counter. A Redis write failure after that marker can be skipped on a poll retry. This pre-existing cross-store accounting limitation is outside this generation-recovery change. Settled costs plus active requested-cap reservations gate admission and may reduce concurrency. Record reported usage for successful, truncated and late replies. Definite HTTP 4xx/5xx and preconnection DNS/refusal errors release reservations without invented charges. Genuinely unknown usage after a lost or locally aborted response conservatively settles that request's reservation, not the 65,536 ceiling.

Each generation request has a 120-second abort timeout bounded by the remaining eight-minute chunk-step deadline, with at most 128 calls per invocation and lease renewal between calls. Cost, deadline and call-count exhaustion stop recovery. Logs retain outcome, finish reason, output/thought token counts, response character count, repetition ratio and timing, never generated or transcript text.

### Podcast-specific quality equivalences

Polish and translation pass minDuplicateChars=40 to the shared quality checker. An exact trimmed repeat is a duplicate if it has at least 40 characters or shares any cue ID with an earlier copy. Short backchannels at distinct cues are retained. The shared default remains zero, so YouTube still rejects any exact paragraph repeat.

Both podcast option builders also enable zhMagnitudes: `N 万` and `N 亿` in article text contribute numeric equivalents of N×10,000 and N×100,000,000 to number coverage. A live translation used `5 万` for 50,000 and `8 万` for 80,000; recognizing these changed its coverage from 0.85 to 0.95 without lowering the threshold. The shared default is false, preserving YouTube checks.

### Verification

Cover the integer-free schema, proportional reservations, recursive recovery, singleton retries, cache reuse, abort/accounting bounds, ten-worker scheduling, overlap stripping, small-sample part gates, isolated retries, and one-pass repair with a step-result-caching fake. Verify short-duplicate and Chinese magnitude options against unchanged YouTube defaults. Run full API tests, typecheck, lint, build, strict OpenSpec validation and diff checks against final limits; record actual results in tasks.md. Generated artifacts remain generator-owned; runtime and browser evidence is recorded in validation.md.

## Risks / Trade-offs

- Token estimates and provider behavior vary → retain output headroom, binary fallback and hard cost/time limits.
- Lost replies cannot prove actual billed usage → conservatively charge only their requested reservation and log unknown usage.
- Natural long repeats can still fail duplicate checks → keep the narrow 40-character exception rather than weakening all quality checks.
- Partition changes can mismatch indexed caches → preserve whole-chunk keys and hash inner source content and prompts.

## Migration Plan

No schema migration or dependency change. Existing whole-chunk caches remain readable; new inner caches are separate. Deployment follows reviewed merge; rollback retains ready articles. Remote retries require separate authorization. Do not modify local runtime configuration or servers as part of automated verification.
