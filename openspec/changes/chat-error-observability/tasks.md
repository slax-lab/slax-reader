# Tasks

## 1. Error taxonomy and copy (design D4)

- [x] 1.1 Add `AI_PROVIDER_UNAVAILABLE` and `AI_PROVIDER_AUTH` to `ErrorName` in `packages/contracts/src/errors.ts` (additive; no existing member renumbered or removed).
- [x] 1.2 Add `zh`/`en`/`es` entries for both new error names in `apps/api/src/const/err.ts`'s `translations` map, and add the `AIProviderUnavailableError()` (503) and `AIProviderAuthError()` (500) factories next to `AIError()`.
- [x] 1.3 Rewrite the `AI_ERROR` copy so it no longer claims a switch to a backup provider, and add the previously-missing `zh`/`es` entries so the message is honest in every supported language. Confirmed by a test that no AI error message contains the old claim.
- [x] 1.4 Verified the new codes render through the `{data, message, code}` envelope: the stream-lifecycle test asserts the serialized frame's `data` and `code` for each factory's class.
- [x] 1.5 Updated `apps/api/test/fixtures/http-error-names.json`, the contract snapshot asserted by `test/handler/http/contracts.test.ts`; without it the additive enum members fail that test.

## 2. Preserve and classify provider failures (design D3)

- [x] 2.1 Added the typed `AIProviderError` in `apps/api/src/infra/external/vertexAIClient.ts` carrying provider HTTP status, provider code, the Google `reference` id (parsed from `internal error; reference = <id>`) and the `overloaded` flag, with the original error kept as `originalError`. The API tsconfig's `es2021` lib declares no `Error.cause`, so the field is explicit. `chatStream`'s `catch` now throws it instead of `AIError()`.
- [x] 2.2 Added `classifyProviderError` (401/403 → auth/config, 429 → existing rate limit, 5xx/overloaded/network/abort-by-timeout → transient unavailable, otherwise → generic), used by the stream handler to map a failure onto a `MultiLangError`.
- [x] 2.3 The initiated abort is tracked by a `timedOut` flag so it classifies as transient unavailability rather than as an unclassified failure; covered by a test that a `timedOut` error with a 400 status still classifies as unavailable.
- [x] 2.4 Replaced the opaque `console.error('ChatStream error:', error)` with one structured log entry of extracted scalars plus the provider message. The API key never enters a log line and the raw error object is not logged.

## 3. Guarantee stream termination (design D1, D2)

- [x] 3.1 Restructured `AigcService.bookmarkChat` so every path runs inside one `try`, and the `catch`/`finally` both `await` their work. The `catch` and `finally` use a locally captured writer, so the guarantee holds even if a concurrent request reassigns the shared `this.wr` field.
- [x] 3.2 Added the awaited close helper, which logs rather than silently swallowing a close failure so it cannot mask the original failure or leak an unhandled rejection.
- [x] 3.3 Added the error-frame writer: exactly one envelope-shaped frame as a plain JSON line ending in a newline, with no SSE `data:` prefix, written before the close on every path.
- [x] 3.4 Removed the generic assistant-sentence failure write, so a failure is never presented as ordinary assistant content; a test asserts the old sentence never appears.
- [x] 3.5 Recorded the summary path (`AigcService.bookmarkSummary`, whose `write`/`close` are also `void`-ed) as an explicit non-goal in the design: same defect class, different endpoint and client surface, deliberately deferred so this change stays verifiable. It is the top follow-up from this work.

## 4. First-byte timeout budget (design D5)

- [x] 4.1 Armed a 30s first-byte timer before creating the stream, passed an `AbortSignal` through `config.abortSignal` on `generateContentStream`, and cleared the timer as soon as the first chunk arrives. The budget is the named constant `CHAT_FIRST_BYTE_TIMEOUT_MS`.
- [x] 4.2 The abort rejects with a distinguishable timeout error that classifies as transient unavailability; the timer is cleared in `finally` on every exit path, so no stray timer outlives the call.
- [x] 4.3 A prompt first chunk clears the budget: covered by a test asserting the signal is not aborted after advancing well past the budget once a chunk has been yielded.

## 5. Web client termination guarantee and ceiling (design D6, D7)

- [x] 5.1 In `apps/web/app/utils/chatbot.ts`, `ChatBot.chat` keeps its "start and return" contract (every caller invokes it fire-and-forget) but the consumer promise is now chained with `.catch(...)`/`.finally(...)`, so a read rejection, a timeout abort and a normal end all report a failure if none was reported and then clear the loading state. `updateChatStatus` was made idempotent so the end-of-stream call and the terminal safety net cannot notify the surface twice.
- [x] 5.2 A missing/empty consumer is treated as a failure to start and surfaces an error instead of returning silently.
- [x] 5.3 The client tracks whether the stream produced any line at all; when it produced none, it emits the existing error status update. Keyed on "no line at all" rather than "no assistant content", because tool-only requests legitimately finish without assistant content.
- [x] 5.4 Added the client-side inactivity ceiling (60s, named constant): an `AbortController` passed as `signal` to `request().stream(...)` with a watchdog reset on every received chunk. On expiry it reports the timeout, aborts, and clears the loading state directly, so a transport that ignores the abort cannot keep the spinner up.
- [x] 5.5 Verified the existing component handling is sufficient: `SnapshotChatPanel.spec.ts`'s `F18` already covers rendering a `STATUS_UPDATE` `error` as a tips bubble, and the loading indicator is driven by `chatStatusUpdateHandler`, whose transitions the new `chatbot.spec.ts` cases cover exhaustively. No component change was needed.
- [x] 5.6 Fixed a delivery gap found while unifying the client's line handling: the streaming path previously ignored envelope error lines entirely (only the end-of-stream path parsed them), so a frame arriving as a complete line mid-stream was dropped. Both paths now share one router, which excludes SSE field lines so `data: {...}` is not misparsed as an envelope.

## 6. Tests

- [x] 6.1 `apps/api/test/domain/aigcChatStream.test.ts`: provider failures of every class, an unexpected error, the validation exits (empty messages, unknown function call) and a throw before dispatch, each asserting the stream is closed and exactly one frame with the expected code is written. Two ordering cases pin the awaited close, which a "was it closed" assertion cannot catch: the frame is written, then the close completes, then the task settles; and a close held open keeps the task pending. Both were confirmed to fail against a temporary revert to the previous `void`-ed write/close. Note: the `!parts[0].functionCall` early return is unreachable (`isToolCallMessage` already requires every part to carry a function call); it is kept as a defensive throw rather than tested.
- [x] 6.2 `apps/api/test/infra/vertexAIClient.test.ts`: classification for 401/403, 429, 500, 503, overloaded, unreachable and 400, plus typed-error field preservation through `chatStream` and the timeout misclassification guard.
- [x] 6.3 Same file: a provider that never yields is aborted at the budget and maps to transient unavailability; a prompt first chunk clears the budget.
- [x] 6.4 `apps/web/tests/unit/utils/chatbot.spec.ts`: the `request().stream` mock now yields a consumer that settles only when the test completes it (mirroring the real consumer), and new cases assert loading is cleared plus an error is emitted for a rejecting consumer, an empty stream, a mid-stream envelope line, a stream rejection, a missing consumer, and the inactivity ceiling (fake timers). The five existing body-shape assertions gained the now-present `signal`.
- [x] 6.5 Covered by existing component coverage (`F18`) plus the exhaustive `chatbot.spec.ts` transitions; no new component case was needed and the component was not modified.
- [x] 6.6 `apps/api/test/handler/http/aigcChatStream.test.ts`: the real controller + real service + a failing provider client, reading the returned `Response` body to prove the HTTP stream ends and carries the envelope — the boundary where the user-visible hang lived. Draining starts before awaiting the background task, because `TransformStream` backpressure holds a write until the body is read.

## 7. Verification

- [x] 7.1 `pnpm api -- test`: 149 files passed, 0 failed (1650 tests). `pnpm api -- typecheck`: error set byte-identical with the change applied and stashed (120 pre-existing errors, all missing-generated-Prisma-client noise in untouched files); the clean main checkout reports 0, and none of the 120 touches a changed file. Web `chatbot.spec.ts`: 35/35. Remaining lint/typecheck/web-suite results recorded in the PR body.
- [ ] 7.2 Local end-to-end: induce a real provider failure (invalid key or cut the worker's egress) and confirm the page shows an error with a usable input instead of an infinite spinner. Not performed: it requires starting the API and web dev servers and interrupting the operator's running local environment. The handler-level test (6.6) covers the same boundary deterministically.
- [ ] 7.3 Local end-to-end regression: normal streaming, tool progress, mermaid rendering and the subscription error path. Partially covered by automated tests (success stream, `[DONE]`, `NOT_SUBSCRIPTION` mapping); the manual pass is deferred with 7.2.
- [ ] 7.4 Run the three local pre-push passes defined in `REVIEW.md` (Bugs / Security / Compliance) and resolve Important findings before pushing.
