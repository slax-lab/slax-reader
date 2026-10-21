# Spec Delta

## Purpose

Provide backward-compatible private bookmark retrieval in which fulltext and vector searches share the same current ownership and optional all-tags constraints, including successfully extracted PDF text.

## ADDED Requirements

### Requirement: Keyword search accepts optional stable tag filters

The bookmark search API SHALL accept a nonempty keyword and optional `tag_uuids` list. Omitted/empty tags SHALL preserve existing keyword-only behavior and response fields. Filters SHALL use distinct stable UUIDs, with a maximum of 20 tags and a keyword limit of 500 Unicode code points. Malformed input SHALL fail validation.

#### Scenario: An existing client submits only a keyword
- **WHEN** a client sends the existing keyword-only request
- **THEN** the API searches that user's saved titles and bodies and retains existing identifiers, ranking and highlight response fields

#### Scenario: Invalid request shape is submitted
- **WHEN** a request has a whitespace-only keyword, malformed tag UUIDs, too many tags or an oversized keyword
- **THEN** it fails validation without running unbounded search work

### Requirement: Both retrieval branches obey current all-tags ownership constraints

Fulltext and vector candidates SHALL belong to the authenticated user's current nondeleted saved bookmarks and carry every requested owned tag. Unknown/foreign tags SHALL yield no matches without ownership disclosure. Current constraints SHALL be checked before response publication, including when cached search associations are used.

#### Scenario: Two tags are selected
- **WHEN** one bookmark has both requested tags and another has only one
- **THEN** only the bookmark carrying both is eligible for either retrieval branch
- **AND** qualifying matches are not lost by filtering only an unrelated global vector top-K

#### Scenario: Ownership or tags change during retrieval
- **WHEN** a candidate is deleted or loses a requested tag before final response admission
- **THEN** that candidate is not returned using stale cached eligibility

#### Scenario: An unrelated account or source contains the term
- **WHEN** the term exists only in another user's article or an unsaved RSS/Collection body
- **THEN** cloud search does not return that content

### Requirement: Successfully extracted PDF text participates in both indexes

PDF text successfully extracted through URL capture or file upload SHALL enter the same fulltext and vector search paths as owned saved article text. Pending, empty or failed extraction MUST NOT be represented as completed body indexing. Index failure SHALL be diagnosable independently of successful file storage.

#### Scenario: A PDF body contains a unique term
- **WHEN** an owned PDF from either import path has completed extraction and indexing and its body contains a term absent from its title
- **THEN** the fulltext retrieval path can find that term
- **AND** the vector retrieval path receives and searches the extracted body representation
- **AND** optional tags and private ownership apply identically to ordinary articles

#### Scenario: A PDF has no usable text
- **WHEN** extraction is pending, empty or failed
- **THEN** the PDF can remain locally discoverable by metadata without claiming body-search coverage
- **AND** no OCR or successful indexing status is invented

#### Scenario: One index write fails
- **WHEN** extraction succeeds but a fulltext or vector write fails
- **THEN** the failure remains visible to the existing processing diagnostics and retry path
- **AND** successful byte storage alone does not establish complete search coverage
