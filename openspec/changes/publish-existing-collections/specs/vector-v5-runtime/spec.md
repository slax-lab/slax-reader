## MODIFIED Requirements

### Requirement: Article metadata and native owner filtering are mandatory

Article representatives and chunks SHALL retain numeric `user_id`, string `kind`, numeric `bookmark_id` and numeric `published_at`; representatives SHALL retain numeric `part_count` for chunk cleanup. Only an article representative owned by a configured publisher SHALL carry `recommendable: true`. Article refresh SHALL use the current allowlist. Chunks SHALL omit the marker. The article feed and its query policy remain independent of the marker. Collection `recommendable` visibility and filtering SHALL remain unchanged. Private vector queries SHALL retain a native numeric `user_id` equality filter before top-K. The approved unified search below SHALL derive that identity from authentication and revalidate current ownership. Its first contract has no tag filter; existing all-tags guarantees remain unchanged on /v1/bookmark/search. Native vector methods alone do not prove acceptance of the new HTTP/SSE interface. Return-only cleanup metadata MUST NOT require a metadata index without an actual filter use.

#### Scenario: Another user's vector is the closest match
- **WHEN** a personal query is executed for A and B has a higher-scoring private vector
- **THEN** the native query is constrained to A and B's record cannot contribute a private result

#### Scenario: Many chunks are replaced
- **WHEN** an article is shortened or deleted after more than ten chunks were written
- **THEN** cleanup uses its actual recorded chunk count and stable private IDs rather than a guessed fixed range

#### Scenario: Publisher and ordinary owner save the same article
- **WHEN** the normal article writer processes both saves
- **THEN** only the allowlisted owner's representative carries the marker.
