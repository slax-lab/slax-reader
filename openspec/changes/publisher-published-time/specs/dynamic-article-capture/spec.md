## ADDED Requirements

### Requirement: Retain a publisher-supplied publication time for URL and PDF captures

The API SHALL accept an optional `published_at` (an ISO 8601 date-time with a time zone or UTC designator) on the add-URL request and as a query parameter of the PDF upload. For an allowlisted publisher, a parseable value no later than the time of the request SHALL become the captured bookmark's publication time. It SHALL take precedence over a time derived from the fetched page, platform metadata, YouTube metadata or PDF metadata, and SHALL be applied to both a fresh capture and a successful capture already owned by that publisher. Without the parameter, from a caller outside the allowlist, or when the value is unparseable or later than the request time, the API SHALL keep its existing publication-time behavior and SHALL accept the save. The response body SHALL be unchanged.

#### Scenario: Publisher saves an older video by URL

- **WHEN** an allowlisted publisher saves a YouTube URL with `published_at` of 2013-08-15T00:00:00Z
- **THEN** the bookmark's publication time is 2013-08-15T00:00:00Z rather than the save time
- **AND** both the owner bookmark detail and the public bookmark content report that time

#### Scenario: Publisher uploads a dated PDF

- **WHEN** an allowlisted publisher uploads a PDF with `published_at` of 2026-11-10T08:00:00Z
- **THEN** the PDF bookmark's publication time is 2026-11-10T08:00:00Z after extraction completes

#### Scenario: Publisher re-saves a bookmark it already captured

- **WHEN** an allowlisted publisher saves a URL or PDF it already captured successfully, with a valid `published_at`
- **THEN** that publisher's bookmark takes the supplied publication time without a new capture
- **AND** its identifiers, body, star and Collection membership are unchanged

#### Scenario: Ordinary caller supplies a time

- **WHEN** a user outside the publisher allowlist saves a URL or uploads a PDF with `published_at`
- **THEN** the save succeeds and the publication time is derived exactly as it was without the parameter

#### Scenario: Invalid or future time

- **WHEN** an allowlisted publisher supplies a `published_at` that cannot be parsed, or that is later than the request time
- **THEN** the save succeeds, the value is ignored and the existing publication-time behavior applies

#### Scenario: Publisher omits the time

- **WHEN** an allowlisted publisher saves a URL or uploads a PDF without `published_at`
- **THEN** the publication time is derived exactly as before

### Requirement: Retain the publication time of supplied publisher article HTML

For an allowlisted publisher's content save, a parseable `article:published_time` in the supplied HTML that is no later than the request time SHALL become the bookmark's publication time, whichever capture route stores the article and including a re-save of a successful capture that publisher already owns. Without that tag, or when its value is unparseable or later than the request time, the existing publication-time behavior SHALL apply. Saves by users outside the allowlist SHALL be unchanged.

#### Scenario: Publisher article captured from the source page

- **WHEN** an allowlisted publisher saves an article whose supplied HTML has `article:published_time` of 2023-10-19T12:01:36Z, and Reader stores the article through a capture route other than the publisher-HTML route
- **THEN** the bookmark's publication time is 2023-10-19T12:01:36Z

#### Scenario: Publisher re-saves an existing article

- **WHEN** an allowlisted publisher re-saves an article it already captured successfully, with HTML whose `article:published_time` differs from the stored time
- **THEN** the bookmark takes the supplied publication time, and its identifiers, body, star and Collection membership are unchanged

#### Scenario: Ordinary user saves article HTML

- **WHEN** a user outside the publisher allowlist saves HTML that has `article:published_time`
- **THEN** the publication time is derived exactly as before
