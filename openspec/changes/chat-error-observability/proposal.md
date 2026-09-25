# Proposal

## Why

When an AI provider call fails, the user's chat bubble spins forever with no error, even though the API logs the failure. Four defects combine to produce that outcome, on both ends of the chat stream.

**1. The server does not guarantee the SSE stream is terminated.** The chat handler hands `AigcService.bookmarkChat` to `ctx.execution.waitUntil` and returns the `Response` immediately (`apps/api/src/handler/http/aigcController.ts:138-144`). Inside `bookmarkChat`, the provider-failure path is covered by a `catch`/`finally` — but `catch` writes with `void this.writeChunk(...)` and `finally` closes with `void this.wr.close()` (`apps/api/src/domain/aigc.ts:441-445`). Neither is awaited, so the `waitUntil` promise settles before the stream has actually closed and the runtime may tear the isolate down mid-close. Three further early-return paths write to the stream and never close it at all (`aigc.ts:425`, `:433`, `:439`), and anything throwing before the `try` at `aigc.ts:431` escapes with no close either.

**2. Provider failures are discarded and replaced by one opaque message.** `VertexAIClient.chatStream` catches every provider error and replaces it with `AIError()` (`apps/api/src/infra/external/vertexAIClient.ts:228-231`), so the provider HTTP status, error code, reference id, and overload flag survive only as an unstructured `console.error`. The stream then carries a generic assistant sentence rather than an error the client can render.

**3. The user-facing copy promises an action the system does not perform.** `AI_ERROR` reads "The AI provider has made a mistake. Don't worry, it's switching to the backup provider." (`apps/api/src/const/err.ts:111`) while a repository-wide search finds `AI_ERROR` only as an enum member, a factory, and this message — there is no failover, no second provider, and no switch path. The copy misleads users and misdirects anyone diagnosing the failure into looking for failover that does not exist.

**4. The client only leaves its loading state on a clean end of stream.** `ChatBot.chat` consumes the stream and calls `updateChatStatus(false)` only inside the `isDone` branch (`apps/web/app/utils/chatbot.ts:160`); the consumer promise returned by `request().stream(...)` is neither awaited nor given a `.catch(...)` (`chatbot.ts:129-181`). Any abnormal termination — a torn-down worker, a read failure, an exception from `request().stream(...)` itself — becomes an unhandled rejection and the spinner stays up forever.

There is no timeout anywhere in the path: `chatStream` awaits the SDK iterator with no `AbortSignal`, and no client caller passes the `signal` that `FetchOptions` already supports. A provider that accepts the connection and never responds therefore hangs rather than failing.

## What Changes

- Guarantee stream termination: every exit path of the chat stream handler (provider failure, validation exit, unknown tool call, pre-`try` exception) writes its terminal frame and **awaits** closing the writable side before the background task completes.
- Emit failures as an error frame using the API's existing `{data, message, code}` envelope, written as a plain JSON line so the client's existing error path (`chatbot.ts:145-157`) parses it with no protocol change.
- Preserve provider failure detail: `VertexAIClient.chatStream` throws a typed error carrying the provider status, provider code, reference id, and overload flag instead of collapsing everything into `AIError()`.
- Add a first-byte timeout budget of 30s to the streaming chat call, implemented with an `AbortSignal` passed to the SDK, and surface a timeout as the transient-unavailable failure rather than pending forever.
- Split the single misleading error into distinct, actionable codes: provider transiently unavailable (5xx / overloaded / network / timeout), provider configuration or authentication failure (401/403), existing rate limit (429), and a neutral generic fallback. Rewrite `AI_ERROR`'s message to describe what actually happened.
- Harden the web chat client so it leaves the loading state on every terminal outcome (clean end, error frame, read failure, request failure, timeout), renders the failure as an error tips bubble, and shows an error instead of silently stopping when a stream ends with no output at all.
- Add a client-side read ceiling (no data received for 60s) that aborts the request via `AbortController` and surfaces a timeout error, as the fallback layer behind the server budget.
- Log provider failure detail in a structured, greppable form for operators, without exposing provider internals or credentials to the client.

## Capabilities

### New Capabilities

- `chat-error-handling`: AI chat fails loudly and recoverably on both ends of the stream — the SSE stream always terminates, failures reach the user as an actionable message that matches real system behavior, provider unavailability is distinguished from provider configuration/authentication failure, timeouts bound both the first byte and client-side inactivity, and provider failure detail is retained for operators without leaking secrets.

### Modified Capabilities

(none)

## Impact

- **Code**: `apps/api/src/domain/aigc.ts` (stream lifecycle in `bookmarkChat`, error-frame emission, timeout wiring), `apps/api/src/infra/external/vertexAIClient.ts` (typed provider error, abort signal, timeout), `apps/api/src/const/err.ts` (new factories and rewritten copy), `packages/contracts/src/errors.ts` (new `ErrorName` members), `apps/web/app/utils/chatbot.ts` (termination guarantee, read ceiling, error rendering), and `apps/web/app/utils/request.ts` only if the ceiling needs the signal threaded through.
- **APIs**: no request-shape change. Response behavior changes only on failure, where a terminating error frame replaces a hanging stream (or a generic assistant sentence). New error codes are additive; the client already renders unknown codes from the server-provided `message`.
- **Behavior**: the `AI_ERROR` copy changes for every surface that uses it, including the summary path (`aigc.ts:415`), which is intended — the current claim is wrong there too.
- **Scope**: the browser extension's independent chat client (`apps/extension/src/components/Chat/chatbot.ts`) is **not** included; it carries its own copy of this defect and gets a follow-up change.
- **Non-goal**: no real backup-provider failover is implemented; the copy is corrected to match reality instead. Adding a second provider is a separate change.
