# Spec Delta

## Purpose

Keep saved-article search bounded and responsive as libraries and article bodies grow while preserving the existing rowid-scoped fulltext retrieval, ownership admission, and visible highlight output.

## ADDED Requirements

### Requirement: Fulltext retrieval preserves the rowid-scoped query

The search pipeline SHALL keep the `filtered_ids` CTE, the `slax_fts_bookmark.rowid` join, and 50-row groups. It MUST NOT replace the query with a global `MATCH` followed by a user filter. Fulltext statements SHALL be sent through D1 `batch()` in groups of at most 10 statements.

#### Scenario: A large library is searched

- **WHEN** a user with N indexed raw rows searches
- **THEN** the service issues `ceil(N / 50)` fulltext statements, not N
- **AND** each statement binds at most 50 row IDs plus the keyword
- **AND** the SQL text and `MATCH` expression are unchanged

#### Scenario: More than 30,000 indexed rows

- **WHEN** a user's indexed row set exceeds 30,000 rows
- **THEN** only the newest 30,000 rows (600 groups) are searched
- **AND** the service logs `search_scope_truncated` with the user and row counts

### Requirement: Search bounds candidates, results, and highlighting

The service SHALL collect at most 300 fulltext candidates, publish at most 100 ranked results, and highlight only those 100. Candidate pruning MUST NOT remove an item that could rank in the final 300.

#### Scenario: A common keyword matches many articles

- **WHEN** fulltext and vector retrieval return more than 100 combined candidates
- **THEN** the response contains the top 100 owned, non-deleted results by RRF score (or fewer when fewer than 100 candidates pass the live check)
- **AND** only those published results receive HTML highlight markup
- **AND** tie-breaking is deterministic by descending score then ascending bookmark id

#### Scenario: A single bookmark has multiple raw shards

- **WHEN** multiple matching shards map to the same bookmark id
- **THEN** only the best-scoring shard is retained for that bookmark

### Requirement: Search degrades instead of failing on external timeouts

Embedding SHALL time out at 800 ms, each vector query at 500 ms, and keyword segmentation at 500 ms. A timeout MUST leave fulltext results available.

#### Scenario: Embedding is slow

- **WHEN** the embedding provider does not respond within 800 ms
- **THEN** the search returns fulltext results without vector matches

#### Scenario: Segmentation is slow

- **WHEN** keyword segmentation does not respond within 500 ms
- **THEN** the service searches with a quoted phrase built from the sanitized keyword

### Requirement: Raw index writes respect D1 parameter limits

`slax_bookmark_raw` inserts SHALL bind at most 16 rows (96 parameters) per statement and SHALL run with the preceding delete in one transactional D1 batch.

#### Scenario: An article produces more than 16 shards

- **WHEN** 17 or more shards are written for one bookmark
- **THEN** they are split across multiple 16-row statements
- **AND** a failure rolls back the delete and all inserts

### Requirement: Fulltext index maintenance is scheduled

The API SHALL run the FTS5 `optimize` command daily at 03:17 UTC.

#### Scenario: Daily maintenance fires

- **WHEN** the `17 3 * * *` cron fires
- **THEN** `INSERT INTO slax_fts_bookmark(slax_fts_bookmark) VALUES('optimize')` runs on `DB_FULLTEXT`
- **AND** failures are logged without affecting user requests
