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
