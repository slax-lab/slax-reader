# Stop reporting a client-closed summary stream as a service failure

## Why

The `reader-ai` monitor reports `[aigc.summary] failed to write error text` (8 times between 2026-11-23 and 2026-11-26) and its sibling `[aigc.summary] failed to close stream` for `POST /v1/aigc/summaries`. Both follow one event: the client stops reading the response — it navigates away or closes the outline panel — which errors the response stream. `AigcService.bookmarkSummary` then treats the rejected delta write as a generation failure, writes the failure text to the same dead stream, and closes it. Both follow-up steps reject with the same cause, so one client departure is logged three times at error level: the rejected write (`undefined` with a `VertexAIClient.chatStream` stack), `failed to write error text`, and `failed to close stream`. The monitor reads error-level Worker logs, so every departure becomes an alert.

Nothing fails on the service side: no user-visible output is lost, and the completed guard already stores no summary for an interrupted stream. The alert is noise from retrying a stream that the client has closed.

## What Changes

- `bookmarkSummary` records that the response stream rejected a write and then stops: it does not write the failure text to that stream, does not close it again, and reports the client departure once at warning level with the request's Ray ID.
- A failed failure-text write and a failed terminal close are reported at warning level, because they also mean the response can no longer be delivered.
- Everything else stays: a provider failure on a live stream still logs at error level with its diagnostic fields, still writes the failure text, and still closes the stream; an interrupted stream still stores nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bookmark-ai-outline`: adds the requirement that a summary stream whose client has left ends without service-error logs while a live stream keeps its error-level failure reporting.

## Impact

- `apps/api/src/domain/aigc.ts`: `bookmarkSummary` tracks a rejected response write, skips the fatal follow-ups on it, and downgrades the stream write/close failures to warnings.
- `apps/api/test/domain/aigcSummaryPersistence.test.ts`: covers the cancelled stream, the failed close after a complete stream, and the failure frame that cannot be written.
- No endpoint, request or response shape, stream frame, cache rule, schema, contract, dependency or client change. Production data is not modified.

## Non-goals

- No change to the failure text, the caching rule, retries, or client behaviour.
- No fix for a provider failure that is preceded by a healthy client disconnect beyond what the existing completed guard already does.

## Approval and delivery

The requester asked in the on-call thread on 2026-11-26 to adopt this fix for the `[aigc.summary] failed to write error text` alert and open a PR. Delivery is a task pull request targeting `dev`; no deployment or production write is part of it.
