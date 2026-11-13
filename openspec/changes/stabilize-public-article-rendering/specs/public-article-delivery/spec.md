## ADDED Requirements

### Requirement: Unchanged hydration retains article descendants

The Web reader SHALL retain complete server-rendered article content and SHALL adopt its existing descendants when initial client HTML is unchanged. Initial changed or empty HTML, fresh client navigation, actual body replacement/clear and keyed remount SHALL still reconcile correctly. Updates without a body change SHALL preserve processed highlights, image handlers and media nodes. The existing synchronous content-write and downstream annotation/media processing order SHALL remain intact.

#### Scenario: Unchanged initial body
- **WHEN** the browser hydrates an article whose client HTML matches the server-rendered body
- **THEN** its original text and image descendants remain attached without a repeated full-body innerHTML assignment
- **AND** highlights, image preview and podcast playback enhancements initialize through their existing lifecycle

#### Scenario: Initial or later content changes
- **WHEN** initial client HTML differs from SSR, becomes empty, or the actual article body changes after mount
- **THEN** the visible body reflects that content before downstream processing
- **AND** unrelated updates do not remove already processed marks or handlers

### Requirement: Diagnostic timing preserves delivery decisions

Existing non-production diagnostic timing SHALL identify access/metadata substeps and complete warm HTML delivery with fixed stage names and numeric durations only. Granular metadata stages SHALL be emitted only for successful authorized metadata responses and SHALL NOT be forwarded from denied cache validation. Timing SHALL preserve call ordering, metadata serialization, fresh authorization/presentation revision validation, credential isolation and the existing cache TTL. Production SHALL omit these diagnostic headers.

#### Scenario: Warm anonymous document
- **WHEN** a non-production request passes the current warm-cache revision validation
- **THEN** timing distinguishes cache lookup, revision validation and cached body reading, with total delivery measured after the body is read
- **AND** a revoked, stale or credential-bearing request retains its existing behavior

#### Scenario: Production metadata request
- **WHEN** metadata or cached HTML is delivered in production
- **THEN** no additional diagnostic header exposes stage details, credentials, identifiers or article text
