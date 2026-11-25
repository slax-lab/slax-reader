## ADDED Requirements

### Requirement: The fulltext branch ranks all owned rows completely and highlights a bounded set

The bookmark search fulltext branch SHALL rank every candidate fulltext row of the user's eligible bookmarks that matches the normalized keyword expression, using one ranking query regardless of the number of candidate rows. It SHALL NOT drop matching rows because the candidate set is split into independently failing parts, because the database is overloaded, or because an excerpt cannot be produced. Highlight excerpts SHALL be produced only for a bounded number of the best-ranked rows; rows beyond the bound SHALL keep their rank and use the existing no-highlight excerpt. A failure of the ranking or highlight query SHALL fail the fulltext branch rather than return a partial fulltext result.

#### Scenario: A user with thousands of fulltext rows searches a common term
- **WHEN** an owned keyword matches rows across thousands of the user's fulltext shards
- **THEN** every matching eligible row is ranked by the same score as before
- **AND** the database work for ranking does not grow with one query per fixed-size group of candidates

#### Scenario: A multi-term keyword matches both title and content
- **WHEN** a keyword with two or more normalized terms matches rows by title proximity, content proximity, or both
- **THEN** those rows are returned with title and content highlights where the term occurs
- **AND** no matching row is omitted because excerpt generation fails

#### Scenario: More rows match than the highlight bound
- **WHEN** the number of matching rows exceeds the highlight bound
- **THEN** the best-ranked rows within the bound carry keyword-centred excerpts identical to the existing excerpt selection
- **AND** the remaining rows are still ranked and fused with vector results, using the existing no-highlight excerpt

#### Scenario: The fulltext database rejects the ranking query
- **WHEN** the ranking or highlight query fails
- **THEN** the fulltext branch reports a failure through the existing search error handling
- **AND** it does not present a subset of matching rows as the complete fulltext result

### Requirement: Every fulltext shard of an owned article is searchable

The fulltext branch SHALL rank every stored fulltext shard of each eligible bookmark, so a term that occurs only in a later shard of a long article can find it. Each bookmark SHALL be represented by its best-scoring shard.

#### Scenario: A term occurs only in the second shard of a long article
- **WHEN** an owned article is stored as several fulltext shards and the keyword occurs only in a later shard
- **THEN** the fulltext branch returns that article once, scored and highlighted from the matching shard

### Requirement: The fulltext relation mirror follows relation deletions

Deleting a user's bookmark relation in PostgreSQL through any deletion path, including the import-failure batch delete and account deletion, SHALL also delete the corresponding fulltext relation mirror row. Operators SHALL have a read-only way to list mirror rows whose PostgreSQL relation no longer exists, as DELETE statements they apply explicitly; trashed relations SHALL be kept.

#### Scenario: A user deletes failed import bookmarks
- **WHEN** the import-failure batch delete removes relations from PostgreSQL
- **THEN** the matching fulltext mirror rows are removed in the same operation

#### Scenario: A failed bookmark is covered by a new save
- **WHEN** saving a URL removes the user's relation to a failed or pending bookmark of the same URL
- **THEN** the matching fulltext mirror row is removed with it

#### Scenario: An operator prunes stale mirror rows
- **WHEN** the operator runs the pruning command against an exported mirror
- **THEN** it reads PostgreSQL in a read-only transaction and writes DELETE statements only for relations PostgreSQL no longer has, without applying them

