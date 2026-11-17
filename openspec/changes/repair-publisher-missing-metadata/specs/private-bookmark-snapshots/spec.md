## ADDED Requirements

### Requirement: Fill missing metadata on a publisher-owned completed HTML bookmark
An allowlisted publisher re-submitting its attributed capture for an already saved URL SHALL be able to fill empty title, site name and byline on its own completed HTML snapshot. Each value SHALL be supported by the submitted document or explicit source title. A previously populated field and any owner alias title SHALL retain their values.

#### Scenario: Reader and its public Collection reflect a repair
- **WHEN** a publisher re-submits a matching source capture for its existing starred HTML bookmark with missing metadata
- **THEN** the bookmark and owner relation keep their identifiers, original URL, star and stored article body
- **AND** both the owner and public readers can retrieve the filled fields exposed by their respective APIs

#### Scenario: Repair is scoped to the publisher's own capture
- **WHEN** the caller is outside the publisher allowlist or the stored snapshot is shared, belongs to another user, or has a different URL
- **THEN** that snapshot's metadata remains unchanged

#### Scenario: Partial evidence or replay
- **WHEN** the submitted document supplies only some missing fields or repeats a previous repair
- **THEN** Reader fills only the available blank fields, preserves existing values and makes no duplicate Collection entry

### Requirement: Preserve attribution for ordinary WeChat articles
Reader SHALL retain the WeChat site name and the supplied author of an ordinary article when building an HTML capture from structured provider data.

#### Scenario: Signed or unsigned provider article
- **WHEN** the provider supplies an ordinary WeChat article
- **THEN** the parsed site is WeChat and the byline uses the signed author, falling back to the account nickname when the author is blank
