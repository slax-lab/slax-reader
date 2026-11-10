# Spec Delta

## Purpose

Defines what outline/summary generation asks the model for and the guarantee that the API delivers that output to clients and storage unchanged.

## ADDED Requirements

### Requirement: Outline and summary generation asks for markdown

The prompt used for outline/summary generation MUST ask the model for the markdown list itself and MUST NOT ask it to wrap that markdown in JSON, a code fence, or any other envelope. The existing markdown requirements (syntax limited to headings and list items, anchor links, language, nesting depth, source excerpts) stay in place.

#### Scenario: Prompt requests markdown only

- **WHEN** the generation prompt is inspected
- **THEN** it contains the markdown-only syntax requirement and contains no JSON output instruction and no `content` envelope

#### Scenario: Regeneration after the change

- **WHEN** an outline or summary is generated after this change
- **THEN** the model is asked for markdown directly, with no format step for the server to undo

### Requirement: The API forwards the model's markdown unchanged

The API MUST NOT add, remove, or reinterpret formatting on AI outline/summary content. What the model produces is what clients receive and what is persisted: the `POST /v1/aigc/summaries` stream and its cached response, `GET /v1/bookmark/summaries`, the `outline` field of the bookmark detail trace, the MCP bookmark-summary resource, and the `outline` payload of `POST /v1/bookmark/outline`.

#### Scenario: Streamed content passes through

- **WHEN** a summary or outline is generated and streamed
- **THEN** the client receives the model's output, with no added envelope and no removed content

#### Scenario: Persisted content equals the delivered content

- **WHEN** a generated outline or summary is persisted
- **THEN** the stored value is the same markdown the client received

### Requirement: Existing transport and access contracts are preserved

The change SHALL NOT alter endpoint paths, request shapes, response content types, stream frame shapes, or bookmark AI access rules. Outline streams keep emitting `{"type":"progress","data":{"outline":"<markdown>"}}` frames followed by `{"type":"progress","data":{"done":true}}`, and read-only visitors keep receiving the owner's outline without generating new content.

#### Scenario: Outline frame shape is unchanged

- **WHEN** `POST /v1/bookmark/outline` serves a cached or newly generated outline
- **THEN** the emitted frames keep the existing shape, with the `outline` value carrying the model's markdown

#### Scenario: Access rules are unchanged

- **WHEN** a caller without generation rights requests an outline or summary
- **THEN** the existing access resolution still applies, with no new generation and no change to what such a caller may read
