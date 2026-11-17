## ADDED Requirements

### Requirement: Only completed, non-empty generations are cached

Outline and summary generation SHALL persist content only when the model stream completes without error and the generated text is non-empty after trimming whitespace. A provider failure, a timeout, a client cancellation or an empty response MUST NOT create or overwrite the stored outline/summary. A stored row whose content is empty or whitespace-only MUST be treated as absent: `POST /v1/aigc/summaries` and the owner path of `POST /v1/bookmark/outline` generate instead of returning it, `GET /v1/bookmark/summaries` omits it, and the owner outline served to read-only viewers and in the bookmark detail trace is not served from it. The client-visible stream on failure, the endpoint shapes and the frame shapes are unchanged.

#### Scenario: Provider fails before producing text

- **WHEN** a summary generation fails before the model streams any text
- **THEN** the client still receives the error text and a closed stream, and no stored summary is created or changed

#### Scenario: Provider fails after partial output

- **WHEN** a summary or outline generation fails after streaming part of the outline
- **THEN** the partial outline is streamed but not persisted

#### Scenario: Client cancels the stream

- **WHEN** the client stops reading the summary stream before generation finishes
- **THEN** no stored summary is created or changed

#### Scenario: Completed generation

- **WHEN** a generation completes with non-empty text
- **THEN** the stored summary equals the text the client received

#### Scenario: Stored empty row from an earlier failure

- **WHEN** a summary is requested without force and the stored row for that bookmark, user and language is empty
- **THEN** the API generates a new summary and the next completed generation replaces the empty row

#### Scenario: Empty rows are not listed

- **WHEN** `GET /v1/bookmark/summaries` finds only empty rows for the bookmark
- **THEN** it returns an empty list, so the client requests a new generation
