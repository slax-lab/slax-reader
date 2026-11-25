## MODIFIED Requirements

### Requirement: Existing search and maintenance remain unchanged

The `/v1/bookmark/search` response, its optional all-tags behavior and its fusion SHALL remain unchanged. Without tag filters its semantic branch SHALL query the V5 article index with the V5 query encoder, restricted natively to the authenticated user, and rescore those candidates by cosine after removing the versioned platform embedding mean; this retrieval SHALL be one `fetch` to the Vector Worker and SHALL run concurrently with the rest of the search, so it MUST NOT wait for the fulltext branch or for an up-front ownership list. Candidates SHALL be filtered by current PostgreSQL ownership before the floor and relative bound are applied, so trashed or removed bookmarks never set them; it SHALL return no semantic hit when the best rescored candidate is below a fixed floor, and otherwise only candidates within a fixed fraction of the best score. With tag filters it SHALL keep the legacy encoder and buckets, which filter by the eligible bookmark ids, because the V5 index cannot be filtered by tag natively. Neither interface SHALL implement tag filters by post-filtering an unrelated top-K. Search SHALL be read-only apart from existing request diagnostics: no article re-embedding, preference refresh, vector mutation, recommendation admission, feed fetching or new database schema. Controllers own HTTP validation/SSE; the existing-style Domain Orchestrator owns concurrency and fusion; Repositories own SQL and native index operations. Request resources SHALL remain available until the stream's work settles, with cleanup on success, failure and cancellation.

#### Scenario: New search serves V5 results
- **WHEN** a caller uses the new unified endpoint
- **THEN** it serves V5 results and no automatic backfill occurs

#### Scenario: An untagged bookmark search uses the V5 index
- **WHEN** a caller searches `/v1/bookmark/search` with a keyword and no tag filter
- **THEN** semantic candidates come from the caller's V5 article vectors and are ranked by mean-centered cosine
- **AND** a keyword related to none of the caller's articles contributes no semantic hit
- **AND** the response shape, fusion and current ownership admission are unchanged

#### Scenario: A semantic hit has no fulltext rows
- **WHEN** an untagged search returns a semantic-only hit for a current article that has no fulltext rows
- **THEN** its title and text are the article's stored title and description, escaped, instead of empty strings

#### Scenario: A tag-filtered bookmark search keeps the legacy buckets
- **WHEN** a caller searches `/v1/bookmark/search` with one or more tag filters
- **THEN** semantic retrieval uses the legacy encoder and buckets restricted to bookmarks carrying every requested tag

#### Scenario: Semantic retrieval does not wait for the fulltext branch
- **WHEN** an untagged search starts
- **THEN** the call to the Vector Worker starts before candidate preparation, tokenization and fulltext ranking have finished

#### Scenario: A trashed bookmark is the closest semantic match
- **WHEN** the best-scoring semantic candidate is a bookmark the user has trashed or removed
- **THEN** it is not returned, and the floor and relative bound are computed from the remaining current candidates

#### Scenario: The Vector Worker fails
- **WHEN** the call to the Vector Worker fails or times out
- **THEN** the search returns its fulltext results without semantic hits, as it does today when the semantic branch fails

### Requirement: Fixed bindings preserve existing Worker ownership

The new runtime SHALL use exactly the article, user and Collection Vectorize bindings plus one native maintenance Workflow. AI SHALL own the native Vectorize bindings, with Core and Edge using existing VECTOR RPC. The Vector Worker SHALL additionally bind the article index natively and only read it, for the semantic retrieval of untagged `/v1/bookmark/search`; it MUST NOT write vectors. Normal development SHALL use ordinary native configuration and retain remote Vectorize access on local AI and local Vector; it MUST NOT require an overlay flag, recipe/shard registry, enable switch, account guessing or implicit fallback. Missing configuration SHALL fail explicitly.

#### Scenario: Normal development starts
- **WHEN** the operator runs the existing development command with explicitly configured bindings
- **THEN** the three indexes are reachable through AI, and the article index through Vector, without an additional vector-specific flag

#### Scenario: Required binding is absent
- **WHEN** maintenance or deployment lacks a required binding
- **THEN** it reports a configuration error instead of silently selecting another index or marking work complete
