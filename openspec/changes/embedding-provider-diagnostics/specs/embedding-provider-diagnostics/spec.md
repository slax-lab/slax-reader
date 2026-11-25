## Purpose

Classify Jina embedding failures from structured provider evidence without exposing article content, credentials or arbitrary provider response data.

## ADDED Requirements

### Requirement: Provider failures retain safe diagnostic detail

When the embedding operation fails and the failure is not retried any further, the service SHALL emit a diagnostic log containing the HTTP status, structured provider error code, bounded redacted detail and request ID when supplied. It MUST NOT emit that diagnostic for an attempt that is retried by batch subdivision or context bisection and later succeeds. It MUST NOT log article input, request bodies, full responses, API keys, authorization headers or unbounded/raw provider payloads. Existing thrown error reasons and retry behavior SHALL remain unchanged.

#### Scenario: Structured Jina error
- **WHEN** Jina responds with a structured validation or account error and the embedding operation finally fails
- **THEN** the diagnostic identifies its code and safe detail so the operator can distinguish it from an embedding write/index failure

#### Scenario: Retried provider rejection
- **WHEN** a provider request fails and the operation subdivides the batch or bisects the text and completes successfully
- **THEN** no provider failure diagnostic is emitted for the rejected attempt

#### Scenario: Final provider failure
- **WHEN** the embedding operation fails after its retries are exhausted
- **THEN** exactly one provider failure diagnostic is emitted for that failure

#### Scenario: Sensitive or malformed error response
- **WHEN** the response is malformed or contains URLs, email addresses, credentials or overlong text
- **THEN** sensitive fragments are withheld or redacted, detail is bounded and the original failure remains unchanged

#### Scenario: Provider request succeeds
- **WHEN** the embedding request succeeds
- **THEN** no provider error diagnostic is emitted and vector behavior is unchanged
