# Spec Delta

## Purpose

Let users capture complete Toutiao articles through TikHub from article URLs and share links, and inspect the same capture locally without starting the application infrastructure.

## ADDED Requirements

### Requirement: Normal article URL compatibility

The system SHALL recognize HTTP(S) article URLs on `toutiao.com`, `www.toutiao.com`, and `m.toutiao.com` with paths `/article/<id>`, `/group/<id>`, `/a<id>`, or `/i<id>`, allowing an optional trailing slash, query string, and fragment. It SHALL retain the decimal article ID as a string and normalize the capture source to `https://www.toutiao.com/article/<id>/`.

#### Scenario: Desktop and mobile URLs identify the same article

- **WHEN** supported article URLs contain ID `7450114952884503059` in any supported path form
- **THEN** each capture uses exactly that ID and the same canonical article URL without tracking parameters

#### Scenario: Non-article and lookalike URLs

- **WHEN** a URL points to a profile, feed, video, unsupported path, or lookalike hostname such as `toutiao.com.example.com`
- **THEN** it is not classified as a supported Toutiao article and does not trigger the dedicated article API request

### Requirement: Bounded share-link resolution

The system SHALL resolve HTTP(S) share links on `t.toutiao.com`, `toutiaolink.com`, `www.toutiaolink.com`, and the `/is/` path on `m.toutiao.com` before fetching article content. It SHALL support absolute and relative HTTP redirect locations, permit at most five redirects, apply bounded request timeouts, and validate each destination against the supported Toutiao article and share hosts. Share-link requests MUST NOT include TikHub authorization.

#### Scenario: Share link resolves to an article

- **WHEN** a supported share link redirects through permitted destinations to a supported article URL
- **THEN** the system captures the article using its exact string ID and canonical article URL

#### Scenario: Resolution cannot establish an article

- **WHEN** a share link expires, returns a challenge without an article redirect, loops, exceeds the redirect limit, times out, or redirects to an unsupported destination
- **THEN** capture reports a failure and does not save a challenge page, call the article API with a guessed ID, or silently switch to a generic scraper

### Requirement: TikHub supplies the complete article

For supported Toutiao articles the system SHALL request the TikHub Toutiao Web article API using the resolved article ID and the existing `TIKHUB_TOKEN`. A successful capture SHALL require both provider success and a nonempty article body. Deletion flags and deleted-content placeholders MUST be rejected even when the provider reports success. The system SHALL preserve available title, author, publication time, paragraphs, links, and images. Metadata-only responses MUST NOT count as successful article capture.

#### Scenario: Complete nested response

- **WHEN** TikHub returns a successful response containing an article body and metadata
- **THEN** capture yields the body and available metadata for the resolved article

#### Scenario: Provider or body failure

- **WHEN** authorization fails, a request fails, the provider reports failure, its payload is malformed, or the article body is missing or empty
- **THEN** the capture fails without saving a successful bookmark containing only metadata and without calling another content provider

#### Scenario: Deleted article returns successful provider status

- **WHEN** the provider returns success with `delete: 1` or a deleted-content placeholder
- **THEN** capture fails without persisting that placeholder as a successful article

### Requirement: Persisted capture remains a readable article

Successful bookmark capture SHALL persist the article HTML and readable text through the existing storage and post-processing flow. It SHALL retain the author's name and a valid available publication timestamp, identify the site as Toutiao, and preserve supported body images. Provider HTML MUST NOT introduce executable scripts, event handlers, or executable URL schemes into the saved article document. Invalid publication metadata SHALL use the existing missing-date behavior rather than fail an otherwise valid capture.

#### Scenario: Article is saved

- **WHEN** a supported article is captured successfully while saving a bookmark
- **THEN** its body and text are stored, its metadata is updated, and normal article post-processing runs

#### Scenario: Untrusted markup is supplied

- **WHEN** provider content contains executable markup alongside valid article content
- **THEN** the saved document retains readable content and permitted media while omitting executable markup

### Requirement: Standalone local capture

The repository SHALL expose `pnpm api -- debug:toutiao <url>` using the same resolution and capture behavior as bookmark saving. The command SHALL accept its token from the process environment, require neither running Workers nor databases, write normalized JSON, HTML, and plain-text artifacts to an ignored local output directory, and report the canonical URL and output paths. It MUST NOT print authorization material or place it in capture artifacts. It SHALL exit unsuccessfully when resolution or capture fails.

#### Scenario: Fish environment supplies credentials

- **WHEN** the local command runs from fish with `TIKHUB_TOKEN` exported and a supported article or share URL
- **THEN** it captures the article and writes inspectable local artifacts without reading or copying secret configuration files

#### Scenario: Missing credentials

- **WHEN** the command is run without `TIKHUB_TOKEN`
- **THEN** it exits unsuccessfully with an actionable missing-variable message and performs no provider request

### Requirement: Existing capture routes remain compatible

The change SHALL preserve existing behavior for supported non-Toutiao platforms and generic article URLs.

#### Scenario: Another platform is captured

- **WHEN** an existing supported platform URL or a generic article URL is saved
- **THEN** it continues to use its existing route, provider selection, and persistence behavior
