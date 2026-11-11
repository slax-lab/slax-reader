# Design

## Context

`VectorEmbeddingClient.request` reads Jina error text only to detect context overflow, then throws `embedding_http_<status>`. Core logs the generic reason. The temporary direct credential succeeded on both reconstructed inputs while the deployed test service consistently returned 422. We need the provider's actual structured error, not more retries or speculation.

## Goals / Non-Goals

**Goals:** expose a safe provider code, bounded detail and request ID; preserve behavior and avoid leaking input or credentials.

**Non-Goals:** change Jina accounts, keys, deployment configuration, request format, retry policy, source data, index state or production settings. Do not retain full error responses or add a general logging framework.

## Decisions

- Keep error classification local to the Jina client. Parse only structured error `code`, `detail` and `request_id`; tolerate alternate `detail` object forms without serializing arbitrary nested content.
- Accept detail only after removing URLs, email addresses, bearer/API-key fragments, quoted long values and excessive length. Structured error codes are restricted to a conservative uppercase pattern. If parsing fails, record only status and the absence of usable structured detail.
- Emit through a dedicated `[embedding-provider]` error log, separate from the existing `[vector-maintenance]` target error. Return/throw the original error unchanged.
- Add tests for structured details, malformed responses, credential/URL/email/long-input redaction and success silence. Deploy only after local tests and builds, then capture the two test failures with Core logs.

## Risks / Trade-offs

- Provider detail may itself contain user text: discard quoted long values and bound detail; never include request inputs or raw JSON.
- An error may be non-JSON or have no usable detail: preserve the generic status rather than inventing a cause.
- Logging adds one diagnostic per failed request, not per successful request or article-history scan. No new remote calls beyond the already authorized replay.
