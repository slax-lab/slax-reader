# Design

## Context

The API's tag delete handler calls `Successed()` without a data payload after detaching the tag and hiding it. The shared Web request layer returns the response `data` field, so a successful empty response becomes `undefined`. A handled 401 response is normalized to an empty string. The modal must distinguish those two outcomes.

## Goals / Non-Goals

**Goals:**

- Recognize `undefined` from a completed delete request as success.
- Avoid emitting a deletion event when the request layer returns the empty-string session-expiry sentinel.
- Always release the loading state.

**Non-Goals:**

- Change the REST endpoint response shape.
- Change server-side tag detachment, soft deletion, or synchronization.
- Add local-first write support for tag rename, promotion, demotion, or deletion.

## Decisions

The modal will use request completion as the success signal for the delete endpoint, except for the request layer's `''` sentinel used after a handled 401. This matches the existing API response contract without requiring an endpoint change. A `try/finally` block guarantees that the loading overlay is cleared when the request rejects.

Alternatives considered: returning `{ ok: true }` from the API would make the current truthiness check work, but would change an otherwise valid empty-response convention and require an API contract change.

## Risks / Trade-offs

- [Risk] A future endpoint implementation could return another falsy success value → keep the behavior covered by the empty-response regression test and document the endpoint contract.
- [Risk] The request layer may handle an expired session before the modal sees it → explicitly recognize its current empty-string sentinel and leave the modal open.
