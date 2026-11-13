# media-article-reliability Specification

## Purpose
Keep YouTube and podcast AI articles reachable and faithful for eligible source inputs, and keep podcast capture independent of a publisher's treatment of direct Worker fetches.

## Requirements

### Requirement: Supported media plans are processed

The per-article budget SHALL cover the most expensive plan the configured duration, input-size and chunk limits allow. When a plan is skipped for cost, the run SHALL log the chunk count, duration, input size, expected cost and cap.

#### Scenario: Long video inside the limits

- **WHEN** a YouTube caption is 2h47m long with fewer than 40 chunks and 400,000 characters
- **THEN** its expected cost fits the $1.00 per-article budget and generation starts instead of returning `too_long`

#### Scenario: Plan still too expensive

- **WHEN** a plan's expected cost exceeds the per-article budget
- **THEN** the version is skipped as `too_long` and the log carries `chunks`, `duration_ms`, `input_chars`, `expected_cost_usd` and `max_cost_usd`

### Requirement: Model thinking cannot consume the article allowance

Every podcast article model call SHALL set a thinking budget of 2,048 tokens. Every YouTube article model call SHALL set the Gemini 3 thinking level `LOW`. In both cases a `MAX_TOKENS` reply SHALL never be treated as a complete article.

#### Scenario: Long chunk completes

- **WHEN** a podcast chunk's prompt is near the 3,000-token target
- **THEN** the model call carries `thinkingConfig: { thinkingBudget: 2048 }` and a `MAX_TOKENS` reply remains retryable instead of being treated as a complete article

#### Scenario: YouTube chunk uses the thinking level

- **WHEN** a YouTube chunk call is made
- **THEN** the model call carries `thinkingConfig: { thinkingLevel: 'LOW' }` and a `MAX_TOKENS` reply is handled by the split rule above

### Requirement: Numeric tokens survive translation

The user message for each chunk SHALL list the chunk's numeric tokens and the system instruction SHALL require every number, date, unit and quantity to be written as digits, never as a word or a Chinese numeral.

#### Scenario: Numbers in a translated article

- **WHEN** the caption contains `10,000`, `100 million`, `24-7` or `2,600`
- **THEN** the chunk prompt lists those tokens and the article keeps them as digits, so the unchanged `number_coverage` check can compare them

### Requirement: Xiaoyuzhou episode pages use Zyte browser mode

A Xiaoyuzhou episode page SHALL be fetched through Zyte browser mode (`browserHtml: true`) first. If Zyte has an API-level failure (missing key, authentication, quota) or the target returns 5xx, the system SHALL fall back to ScrapingBot browser mode and then to a direct public fetch. The rendered HTML SHALL be parsed only to extract the episode fields, including the audio URL handed to AssemblyAI. A target 4xx SHALL be terminal and save the link as a normal page; if every fetcher fails transiently, the error SHALL throw so the crawl step retries.

#### Scenario: Publisher blocks direct fetch

- **WHEN** Xiaoyuzhou answers a direct Worker fetch with HTTP 403
- **THEN** the page is fetched by Zyte browser mode and the parsed audio URL starts the podcast workflow

#### Scenario: Zyte target returns 4xx

- **WHEN** Zyte reports HTTP 404 or 403 for the target page
- **THEN** the podcast branch returns null, the bookmark is saved as a normal page, no other fetcher is tried, and no AssemblyAI job is created

#### Scenario: Zyte is unavailable at the API level

- **WHEN** Zyte reports an API-level 4xx/5xx such as a missing key, auth failure, quota or rate limit
- **THEN** the page is fetched by ScrapingBot browser mode, then by a direct public fetch if ScrapingBot also fails

#### Scenario: Every fetcher fails transiently

- **WHEN** Zyte, ScrapingBot and the direct fetch all fail with a transient error
- **THEN** the error is thrown so the crawl step retries instead of silently saving a page

### Requirement: Podcast Labs rollout reaches existing podcast savers

An additive migration SHALL enable the `podcast` Labs feature for accounts that already saved a recognised podcast link. It SHALL NOT overwrite an existing `enabled = false` row. The crawl SHALL log when a recognised podcast link is saved as a page because the switch is off.

#### Scenario: Account already saves podcasts

- **WHEN** the migration runs and an account has a non-deleted Xiaoyuzhou, Apple Podcasts, Spotify or direct-audio bookmark
- **THEN** the account gets a `podcast = true` row unless one already exists

#### Scenario: Account explicitly turned the switch off

- **WHEN** the account already has `podcast = false`
- **THEN** the migration leaves that row false

#### Scenario: Switch still off

- **WHEN** a recognised podcast link is saved while the `podcast` Labs feature is off
- **THEN** the link is saved as a normal page and the log names the bookmark and the Labs fallback

### Requirement: A truncated chunk reply changes the input

When a chunk model call ends with `MAX_TOKENS`, the run SHALL NOT repeat the same call. It SHALL split the chunk's own cues into equal parts, in cue order, and call the model once per part, then join the parts in order into the chunk result. A part that ends with `MAX_TOKENS` SHALL be split again, up to 4 parts per chunk. A chunk that still truncates at 4 parts SHALL fail the version as `chunk_truncated` with no automatic retry, and the owner SHALL be able to request an explicit retry.

#### Scenario: One split recovers the chunk

- **WHEN** the whole-chunk call ends with `MAX_TOKENS` and both half-chunk calls return valid replies
- **THEN** the chunk result holds the sections of both halves in cue order, the run continues with the next chunk, and the model received exactly 3 calls for that chunk

#### Scenario: Truncation at the split limit

- **WHEN** a chunk still returns `MAX_TOKENS` after the split into 4 parts
- **THEN** the version is `failed` with `error_message` starting with `chunk_truncated`, the sweeper does not start it again, and the owner's status shows `can_retry`

### Requirement: The output limit follows the input size

Each chunk model call SHALL set `maxOutputTokens` to 4 times the estimated token count of its user message, with a floor of 4,000 and a ceiling of 16,000 tokens.

#### Scenario: Normal chunk

- **WHEN** a chunk's user message is about 2,500 tokens
- **THEN** the call carries `maxOutputTokens: 10000`

#### Scenario: Small part

- **WHEN** a part's user message is 600 tokens
- **THEN** the call carries `maxOutputTokens: 4000`

### Requirement: Truncation telemetry

For every reply that ends with `MAX_TOKENS`, the run SHALL log one event with the article id, chunk index, part count, input token count, candidate token count, thought token count and a repetition ratio of the reply text. The log SHALL carry no caption or reply text.

#### Scenario: Truncated reply logged

- **WHEN** a chunk call ends with `MAX_TOKENS`
- **THEN** one `youtube_article_truncated` log line carries `article_id`, `chunk`, `parts`, `input_tokens`, `candidate_tokens`, `thought_tokens` and `repetition_ratio`, and no field contains transcript or article words
