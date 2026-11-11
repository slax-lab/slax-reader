# Design

## Context

`VectorEmbeddingClient.request` reads Jina error text only to detect context overflow, then throws `embedding_http_<status>`. Core logs the generic reason. The temporary direct credential succeeded on both reconstructed inputs while the deployed test service consistently returned 422. We need the provider's actual structured error, not more retries or speculation.

## Goals / Non-Goals

**Goals:** expose a safe provider code, bounded detail and request ID; preserve behavior and avoid leaking input or credentials.

**Non-Goals:** change Jina accounts, keys, deployment configuration, request format, retry policy, source data, index state or production settings. Do not retain full error responses or add a general logging framework.

## Decisions

- Keep error classification local to the Jina client. Parse only structured error `code` and `request_id`. Alternate `detail` object forms are ignored rather than serialized.
- Retain only static safe detail labels for a small allowlist of known provider codes; never log arbitrary provider detail, whether single-line, multi-line, quoted or unquoted. Structured error codes use a conservative uppercase pattern. If parsing fails, record only status.
- Emit through a dedicated `[embedding-provider]` error log, separate from the existing `[vector-maintenance]` target error. Return/throw the original error unchanged. Preserve the request ID from the body or header independently of detail presence.
- Add tests for structured detail shapes, multi-line article excerpts, malformed responses and success silence. Keep this delivery PR-only: no deployment or replay is authorized here.

## Risks / Trade-offs

- Provider detail may itself contain user text: do not log it at all. Use only static labels for known codes and retain the provider's structured code to identify other causes.
- An error may be non-JSON or have no allowlisted detail: preserve the generic status/code rather than echoing input or inventing a cause.
- Logging adds one diagnostic per failed request, not per successful request or article-history scan. This delivery adds no remote calls.
