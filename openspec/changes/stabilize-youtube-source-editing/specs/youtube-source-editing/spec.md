## ADDED Requirements

### Requirement: Source-bound editing and resumable translation

New edited YouTube article runs SHALL assign each cleaned cue to exactly one ordered passage before asking the model to edit. The service SHALL retain source wording when an edit loses substantive words or changes their order. Publishing SHALL require complete translated content and the existing article checks.

#### Scenario: A guest interjects during a question

- **WHEN** one cue crosses a speaker boundary or a guest interjects between two parts of a question
- **THEN** passage references follow source order and an invalid edit is replaced with its source text

#### Scenario: Partial translation is retried

- **WHEN** a translation batch supplies only some valid passage results
- **THEN** persist valid results and request only outstanding passages on retry

#### Scenario: Upgrade during a run

- **WHEN** a pre-upgrade workflow resumes or a completed article is read
- **THEN** retain its existing workflow or published representation
