# Spec Delta

## ADDED Requirements

### Requirement: A truncated chunk reply changes the input

When a chunk model call ends with `MAX_TOKENS`, the run SHALL NOT repeat the same call. It SHALL split the chunk's own cues into equal parts, in cue order, and call the model once per part, then join the parts in order into the chunk result. A part that ends with `MAX_TOKENS` SHALL be split again, up to 4 parts per chunk. A chunk that still truncates at 4 parts SHALL fail the version as `chunk_truncated` with no automatic retry, and the owner SHALL be able to request an explicit retry.

#### Scenario: One split recovers the chunk

- **WHEN** the whole-chunk call ends with `MAX_TOKENS` and both half-chunk calls return valid replies
- **THEN** the chunk result holds the sections of both halves in cue order, the run continues with the next chunk, and the model received exactly 3 calls for that chunk

#### Scenario: Truncation at the split limit

- **WHEN** a chunk still returns `MAX_TOKENS` after the split into 4 parts
- **THEN** the version is `failed` with `error_message` starting with `chunk_truncated`, the sweeper does not start it again, and the owner's status shows `can_retry`

### Requirement: The output limit follows the input size

Each chunk model call SHALL set `maxOutputTokens` to 4 times the estimated token count of its user message, with a floor of 4,000 and a ceiling of 16,000 tokens.

#### Scenario: Normal chunk

- **WHEN** a chunk's user message is about 2,500 tokens
- **THEN** the call carries `maxOutputTokens: 10000`

#### Scenario: Small part

- **WHEN** a part's user message is 600 tokens
- **THEN** the call carries `maxOutputTokens: 4000`

### Requirement: Truncation telemetry

For every reply that ends with `MAX_TOKENS`, the run SHALL log one event with the article id, chunk index, part count, input token count, candidate token count, thinking token count and a repetition ratio of the reply text. The log SHALL carry no caption or reply text.

#### Scenario: Truncated reply logged

- **WHEN** a chunk call ends with `MAX_TOKENS`
- **THEN** one `youtube_article_truncated` log line carries `article_id`, `chunk`, `parts`, `input_tokens`, `candidate_tokens`, `thought_tokens` and `repetition_ratio`, and no field contains transcript or article words

## MODIFIED Requirements

### Requirement: Model thinking cannot consume the article allowance

Every podcast article model call SHALL set a thinking budget of 2,048 tokens. Every YouTube article model call SHALL set the Gemini 3 thinking level `LOW`. In both cases a `MAX_TOKENS` reply SHALL never be treated as a complete article.

#### Scenario: Long chunk completes

- **WHEN** a podcast chunk's prompt is near the 3,000-token target
- **THEN** the model call carries `thinkingConfig: { thinkingBudget: 2048 }` and a `MAX_TOKENS` reply remains retryable instead of being treated as a complete article

#### Scenario: YouTube chunk uses the thinking level

- **WHEN** a YouTube chunk call is made
- **THEN** the model call carries `thinkingConfig: { thinkingLevel: 'LOW' }` and a `MAX_TOKENS` reply is handled by the split rule above
