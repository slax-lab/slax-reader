## MODIFIED Requirements

### Requirement: The API forwards the model's markdown unchanged

The API MUST NOT add, remove, or reinterpret formatting on AI outline/summary content. What the model produces is what clients receive and what is persisted: the `POST /v1/aigc/summaries` stream and its cached response, `GET /v1/bookmark/summaries`, the `outline` field of the bookmark detail trace, and the `outline` payload of `POST /v1/bookmark/outline`.

#### Scenario: Streamed content passes through

- **WHEN** a summary or outline is generated and streamed
- **THEN** the client receives the model's output, with no added envelope and no removed content

#### Scenario: Persisted content equals the delivered content

- **WHEN** a generated outline or summary is persisted
- **THEN** the stored value is the same markdown the client received
