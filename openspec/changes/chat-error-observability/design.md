# Design

## Context

The chat stream crosses three boundaries that all fail open today.

Server: `AigcController.handleCompletionsRequest` (`apps/api/src/handler/http/aigcController.ts:102-145`) builds an unconfigured `TransformStream`, hands `AigcService.bookmarkChat(ctx, title, content, messages, writable, quote)` to `ctx.execution.waitUntil`, and returns the readable side as `text/event-stream`. The service takes a writer from that stream (`aigc.ts:422`) and is therefore the only owner of the stream's lifecycle.

Provider: `AigcService.chatRawContentText` (`aigc.ts:194-279`) calls `VertexAIClient.chatStream`, which builds `requestConfig` and awaits `ai.models.generateContentStream(...)` (`vertexAIClient.ts:174`), consuming the SDK's async iterator. `@google/genai@2.10.0`'s `GenerateContentConfig` exposes `abortSignal?: AbortSignal` (verified in the installed `dist/node/node.d.ts:4666`), so cancellation is available without racing promises.

Client: `ChatBot.chat` (`apps/web/app/utils/chatbot.ts:116-182`) awaits `request().stream(...)` to obtain a consumer function, invokes it without `await` or `.catch(...)`, and calls `updateChatStatus(false)` only in the `isDone` branch. `FetchRequest.stream` (`packages/frontend-utils/src/request.ts:84-89`) already forwards `signal` to `fetch`, and its consumer loop (`:132-148`) calls `handler('', done)` exactly once after the reader reports done.

Envelope: `createResponse` serializes a `MultiLangError` as `{data: error.name, message: error.getMessage, code: error.errCode}` (`apps/api/src/utils/responseUtils.ts:19-33`), and messages are localized through a module-global language (`multiLangError.ts`). The client's error path already parses exactly this shape from a non-SSE line (`chatbot.ts:145-157`) and feeds it to `handleData`, which emits a `STATUS_UPDATE` with `name: 'error'` and `status: 'failed'` (`chatbot.ts:192-204`); `SnapshotChatPanel.vue:274-275` renders that as an error tips bubble, and `chatStatusUpdateHandler` (`:298`) stops the `chat-loading` indicator (`:99`) when `isChatting` goes false.

Constraints that shape the approach:

- The client's SSE path parses any SSE-framed payload as a `ChatCompletionChunk` and would throw on an error payload; only a **non-SSE** line reaches the envelope parser. The error frame's framing is therefore load-bearing, not cosmetic.
- `updateChatStatus(false)` is the single switch that hides the loading indicator, so it must be reachable from every termination path, not just clean completion.
- `bookmarkChat` holds the only writer on the stream; once it has called `getWriter()`, the controller cannot close the stream (the stream is locked), so termination guarantees must live inside the service.
- Worker `waitUntil` keeps the isolate alive only until the passed promise settles; work not awaited inside that promise is not guaranteed to finish.

## Goals / Non-Goals

**Goals:**

- Every terminal path of a chat stream ends the response stream, on the server and on the client, with no unbounded pending state.
- A provider failure reaches the user as a message that describes what actually happened and what they can do.
- Operator-visible detail (provider status, code, reference, overload flag) survives to the logs.
- Provider transient unavailability is distinguishable from provider configuration/authentication failure.
- Bounded wait: a first-byte budget on the server and an inactivity ceiling on the client.

**Non-Goals:**

- No real backup-provider failover. The copy is corrected to match reality; a second provider is a separate change.
- No retry/backoff of the provider call inside this change.
- No changes to the successful streaming protocol, the chunk shape, tool-progress frames, `[DONE]`, or mermaid rendering.
- No browser-extension client changes (`apps/extension/src/components/Chat/chatbot.ts` has its own copy of this defect and gets a follow-up change).
- No changes to the summary stream (`AigcService.bookmarkSummary`). It carries the same un-awaited `write`/`close` pattern, but it is a different endpoint with a different client surface, and the capability under change is chat; fixing it is a deliberate follow-up so this change stays small and verifiable.
- No cancellation of an in-flight chat when its surface tears down. `destruct()` clears the response callback, but the stream keeps running until it ends or the idle bound fires. Aborting it there is a distinct observable behavior with its own scenarios, so it is recorded as a follow-up rather than folded in here.
- No user-visible provider internals (raw provider payloads, stack traces, references) — diagnostics go to logs.
- No telemetry/metrics pipeline; structured logs only.

## Decisions

### D1: Await the close in a single `finally`, with all paths inside the `try`

Restructure `AigcService.bookmarkChat` so that validation and dispatch both happen inside one `try`, and the `finally` block awaits a safe close helper:

```
this.wr = writer.getWriter()
const wr = this.wr   // our own handle, immune to a concurrent request reassigning this.wr
try {
  // empty-messages check, tool-call checks, dispatch — all throw or write inside here
} catch (err) {
  await this.writeChatErrorFrame(wr, err)   // one error frame, awaited
} finally {
  await this.closeChatStream(wr)            // awaits wr.close(), logs and swallows close failures
}
```

This removes all four current defects at once: the three early returns that write without closing (`aigc.ts:425`, `:433`, `:439`) move inside the `try`; the pre-`try` throw surface (`:423-429`) disappears; and the `void`-ed write/close pair (`:441-445`) becomes awaited so the `waitUntil` promise no longer settles before the stream has closed.

Alternative considered: have the controller close the stream when `bookmarkChat` rejects. Rejected — the writer obtained at `aigc.ts:422` locks the stream, so the controller cannot close it, and a rejection-based design still misses every path that returns without throwing.

Alternative considered: error the stream with `writable.abort()`. Rejected — the client would observe a read rejection instead of a delivered error frame, and a graceful close both delivers the frame and ends the stream.

### D2: Failures are written as a plain JSON envelope line, not an SSE frame

The terminal failure is written as `JSON.stringify({data: errorName, message: localizedMessage, code: errCode}) + '\n'`, matching what `createResponse` produces for non-streaming errors.

This is required by the client's parser: an SSE-framed `data: {...}` line is decoded and passed to `handleData` as a `ChatCompletionChunk`, where `data.choices.length` throws and the existing `try/catch` swallows it silently. A plain line falls through to the `{data, message, code}` branch (`chatbot.ts:145-157`), which is the path `NOT_SUBSCRIPTION` already uses. Reusing this framing means **no client protocol change** for error delivery.

The trailing newline is written so the line decoder yields the frame deterministically rather than depending on `flush()` behavior at close.

Reusing the envelope was necessary but not sufficient: the client only parsed envelopes on the end-of-stream path, so a frame arriving as a complete line mid-stream was dropped. Both paths now go through one line router that parses a bare `{...}` line as an envelope either way. The router deliberately excludes SSE field lines (`data: {...}`), which the SSE decoder emits as an event on the following empty line — feeding those to the envelope parser would log a parse error for every chunk.

### D3: Preserve provider failure detail in a typed error

`VertexAIClient.chatStream` stops discarding the caught error. It rethrows a dedicated provider error carrying the fields the SDK exposes — HTTP status, provider code, the Google `reference` id when the message matches Google's `internal error; reference = <id>` format, and the SDK's overload flag — keeping the original error as `originalError`. The API tsconfig targets `es2021`, whose lib declares no `Error.cause`, so the field is explicit rather than the runtime `cause` property.

Constraint: the provider error must remain distinguishable from an abort we initiated (D5) so a timeout is classified as transient unavailability rather than as an unknown failure.

Alternative considered: keep throwing `AIError()` and log detail separately. Rejected — the caller needs the classification to choose the user-facing code, so the information has to travel with the error.

### D4: Error taxonomy — distinct codes, honest copy

| Provider outcome | Code | Factory | User-facing meaning |
| --- | --- | --- | --- |
| 401 / 403 | `AI_PROVIDER_AUTH` (new) | `AIProviderAuthError()` | The AI service is misconfigured on our side; retrying will not help. |
| 429 | `AI_RATE_LIMIT` (existing) | `AIRateLimitError()` | Rate limited; retry shortly. |
| 5xx / overloaded / network / abort-by-timeout | `AI_PROVIDER_UNAVAILABLE` (new) | `AIProviderUnavailableError()` | Temporarily unavailable; retry is the action. |
| anything else | `AI_ERROR` (existing) | `AIError()` | Rewritten neutral message; no failover claim. |

New members are additive in `packages/contracts/src/errors.ts` and get entries in every language map of `apps/api/src/const/err.ts` (`zh`/`en`/`es`).

The current copy ("Don't worry, it's switching to the backup provider.") is replaced everywhere, including the summary path (`aigc.ts:415`), because the claim is false there too.

Alternative considered: keep `AI_ERROR` only and vary the message text. Rejected — the client maps codes to behavior, and the requirement is that transient and configuration failures be distinguishable, which needs stable codes.

### D5: First-byte budget on the server, inactivity ceiling on the client

Server: arm a 30s timer immediately before creating the stream, pass `config.abortSignal` to the SDK, and clear the timer as soon as the first chunk arrives. The budget therefore covers time-to-first-byte only, which is the failure mode actually observed (provider accepts the connection and never responds). Single, named constant so the budget is tunable.

Client: a separate inactivity ceiling of 60s — no data received for 60s — implemented with an `AbortController` passed as `signal` to `request().stream(...)` and a watchdog timer reset on every received chunk. When it fires it reports the timeout, aborts the request, and clears the loading state directly: the abort is asynchronous, so a transport that ignores it must not be able to keep the spinner up.

The two layers are deliberately not the same mechanism: the server budget bounds "the model never started", the client ceiling bounds "the stream died mid-flight", which the server cannot detect once it has begun producing output. A client total-duration cap was rejected: it would kill legitimately long answers.

### D6: The client terminates loading on any settlement, without blocking the caller

`ChatBot.chat` keeps its existing "start and return" contract — every caller in `SnapshotChatPanel.vue` invokes it fire-and-forget — but the promise returned by the consumer is no longer left floating. It is chained with `.catch(...)` and `.finally(...)`, so a read rejection, a timeout abort, and a normal end all run the same termination: report a failure if none was reported, then clear the loading state.

`updateChatStatus` becomes idempotent: it notifies the handler only when the value actually changes. That is what lets the end-of-stream path keep clearing loading synchronously while the terminal chain clears it again as a safety net, without the surface flushing its buffer twice.

Alternative considered: `await` the consumer inside `chat()` and move `updateChatStatus(false)` into a `finally`. Rejected — it changes `chat()` from "start the stream" to "run the stream to completion" and inverts the timing every existing test relies on, for no guarantee the terminal chain does not already provide.

A missing consumer function (`request().stream(...)` resolving falsy, which the old `callBack && ...` guard implied is possible) is treated as a failure to start rather than a silent no-op.

### D7: A stream with no output at all is a failure, not a silent stop

The client tracks whether the stream produced any line at all. If the stream ends having produced none, it emits the same error status update used for error frames, so a server that closes without a frame produces visible feedback instead of an empty bubble.

The check is deliberately "no line at all" rather than "no assistant content": tool-only requests (`ChatParamsType.QUESTIONS` and `ASK`) legitimately finish without assistant content, so keying on content would turn them into false errors.

### D8: Structured logs, no provider internals to the client

Provider failure detail is logged as a single structured entry with named fields (provider status, provider code, reference, overloaded flag, timeout flag, and the original error's message), replacing the current opaque `console.error('ChatStream error:', error)` + `AIError()` pair. The classification outcome is logged once more at the stream boundary with the user-facing code and the cause message.

The client-visible message carries the error code and an actionable sentence only. No API key, no raw provider payload, no stack trace, and no Google reference id is sent to the browser; the reference stays in operator logs. Secrets are never logged — the API key is only read from `env.VERTEX_API_KEY` (`vertexAIClient.ts:30`) and is not included in any error or log payload.

## Risks / Trade-offs

- **Error frames on a partially streamed answer.** A failure after content has been delivered now appends an error tips bubble beneath the partial answer. This is intended (the answer is incomplete and the user must know), but it is a visible behavior change on that path.
- **The 30s first-byte budget is a guess.** It is generous for a streaming model call that normally returns a first chunk in well under a second, but a cold provider could exceed it. The constant is isolated so it can be tuned without touching control flow.
- **Client ceiling interacts with slow tools.** The 60s inactivity window resets on any received chunk, including tool-progress frames, so a long-running search that emits progress will not trip it; a fully silent 60s will.
- **New error codes are visible in the API contract.** Additive only, and the client renders unknown codes from the server-provided message, so older clients degrade to the message text rather than breaking.

## Testing Strategy

- **API, unit, stream lifecycle**: drive `AigcService.bookmarkChat` with a mocked provider client that throws each failure class, and assert the stream is closed, exactly one envelope-shaped error frame is written, and the frame's code matches the class. Two ordering cases additionally pin the *awaited* close — frame, then close, then task settlement; and a held-open close keeps the task pending — because a boolean "was closed" assertion also passes against the old `void`-ed close and therefore cannot detect the teardown race. Cover the previously-unclosed early-return paths (empty messages, unknown function call) and a throw raised before dispatch.
- **API, handler, end to end**: drive the real `AigcController` + real `AigcService` against a failing provider client and read the returned `Response` body, proving the HTTP stream ends and carries the envelope — the boundary where the user-visible hang actually lived. Draining the body must start before awaiting the background task, because a `TransformStream` applies backpressure that holds a write until the body is read.
- **API, unit, provider classification**: assert `VertexAIClient.chatStream` maps 401/403, 429, 5xx/overloaded, and abort-by-timeout to the right typed error while preserving status/code/reference, and that the abort path is not misclassified as an unknown error. The provider-shape case uses the SDK's real exported `ApiError`, not only a hand-built object, so the numeric-status assumption is pinned against the actual library rather than against a mock that happens to match it.
- **API, unit, timeout**: assert a provider that never yields a first chunk aborts at the budget and produces the transient-unavailable failure; assert a provider yielding promptly is not aborted.
- **API, contract fixture**: adding error names changes `ErrorName`, which `test/handler/http/contracts.test.ts` snapshots against `test/fixtures/http-error-names.json`; the fixture is updated in the same change.
- **Web, unit (`apps/web/tests/unit/utils/chatbot.spec.ts`)**: the suite's `request().stream` mock now yields a consumer that settles only when the test completes it, mirroring the real consumer. Assert that loading is cleared and an error status is emitted on: clean end with content, an envelope error line arriving mid-stream, a stream ending with no line at all, a consumer that rejects, a `request().stream` rejection, a missing consumer, and the inactivity ceiling firing.
- **Web, component (`SnapshotChatPanel.spec.ts`)**: the existing `F18` case already covers rendering a `STATUS_UPDATE` `error` as a tips bubble; the loading indicator is driven by `chatStatusUpdateHandler`, whose transitions the `chatbot.spec.ts` cases above now cover exhaustively, so no component change or new component case is needed.
- **Manual end-to-end**: induce a provider failure (invalid key or cut the worker's egress) and observe an error bubble plus a usable input instead of an infinite spinner; confirm normal answers, tool progress, and mermaid rendering are unchanged.
