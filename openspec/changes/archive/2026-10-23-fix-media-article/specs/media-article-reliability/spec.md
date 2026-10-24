# media-article-reliability Specification

## Purpose

Keep YouTube and podcast AI articles reachable and faithful for every input the existing duration, input-size and chunk limits accept, and keep podcast capture independent of a publisher's treatment of direct Worker fetches.

## ADDED Requirements

### Requirement: Supported media plans are processed

The per-article budget SHALL cover the most expensive plan the configured duration, input-size and chunk limits allow. When a plan is skipped for cost, the run SHALL log the chunk count, duration, input size, expected cost and cap.

#### Scenario: Long video inside the limits

- **WHEN** a YouTube caption is 2h47m long with fewer than 40 chunks and 400,000 characters
- **THEN** its expected cost fits the $1.00 per-article budget and generation starts instead of returning `too_long`

#### Scenario: Plan still too expensive

- **WHEN** a plan's expected cost exceeds the per-article budget
- **THEN** the version is skipped as `too_long` and the log carries `chunks`, `duration_ms`, `input_chars`, `expected_cost_usd` and `max_cost_usd`

### Requirement: Model thinking cannot consume the article allowance

Every YouTube and podcast article model call SHALL set a thinking budget of 2,048 tokens so thinking tokens cannot exhaust `maxOutputTokens` and truncate the JSON reply.

#### Scenario: Long chunk completes

- **WHEN** a chunk's prompt is near the 3,000-token target
- **THEN** the model call carries `thinkingConfig: { thinkingBudget: 2048 }` and a `MAX_TOKENS` reply remains retryable instead of being treated as a complete article

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
