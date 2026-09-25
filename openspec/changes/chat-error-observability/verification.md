# Verification

Evidence gathered for `chat-error-observability` in worktree `.local/worktrees/chat-error-observability` (branch `fix/chat-error-observability`), on top of `dev` @ `cfa8786`.

## Baselines

Every check was compared against a clean tree so pre-existing failures are not attributed to this change.

| Check | Changed tree | Clean baseline | Conclusion |
| --- | --- | --- | --- |
| `pnpm api -- test` | 149 passed / 0 failed (1653 tests), 158 files | main checkout: 145 passed / 1 failed (missing `@electric-sql/pglite`), 155 files | No failures introduced; the 3 added files are the new suites. The worktree's own run is fully green because its install resolves `pglite`. |
| `pnpm api -- typecheck` | 120 errors | 120 errors, byte-identical multiset; main checkout: 0 errors | The 120 are missing-generated-Prisma-client noise in this fresh worktree, present identically with the change applied and stashed, and none touches a changed file. |
| `pnpm web -- typecheck` | exit 0, clean | n/a | No errors. |
| `pnpm web -- test` | 12 failed files / 109 failed tests | main checkout: 13 failed files / 118 failed tests | The changed tree's failing-file set is a **strict subset** of the baseline's (the only difference is `tests/unit/utils/mermaid.spec.ts`, unrelated to this diff). No new failures. Neither `chatbot.spec.ts` nor `SnapshotChatPanel.spec.ts` is in either failing set. |
| `pnpm extension -- test` | 5 files / 18 tests passed | — | Includes the two new failure-envelope cases. |
| `pnpm extension -- compile` | clean | — | `vue-tsc --noEmit`, no errors (it caught a tuple-typed helper in the new test, since fixed). |
| API lint (changed files) | 15 warnings | 15 warnings, identical multiset | Zero new warnings; the previous "18" counted three `File ignored` notices. |
| Web lint (`chatbot.spec.ts`) | 1 error, 0 warnings | 1 error, 0 warnings | Back to the baseline's single pre-existing import-sort error after an intermediate version briefly added one. |
| Extension lint (changed files) | 1 error (import-sort, pre-existing) | 1 error, identical | `chatbot.ts` is byte-identical to baseline; the new test file adds none. |
| `openspec validate --all --strict` | 15 passed, 0 failed | — | Change validates strictly. |

## Tests that were confirmed to catch the original defect

The core defect was a stream that never terminated. A "was the stream closed" assertion does **not** catch it, because the old code did call `close()` — it just never awaited it. The ordering tests added in `apps/api/test/domain/aigcChatStream.test.ts` were therefore validated against a temporary revert:

```
# bookmarkChat's catch/finally temporarily restored to void-ed fire-and-forget
× writes the error frame, then closes, then settles
  → expected [ 'error-frame', 'task-settled' ] to deeply equal [ 'error-frame', 'close', 'task-settled' ]
× a pending close keeps the task pending, proving the close is awaited
  → expected true to be false
```

Both fail against the old behavior and pass against the fix; the source was restored with `git checkout` immediately afterwards. This is the evidence that the awaited-close guarantee is actually pinned.

The extension regression test was validated the same way: disabling the new `else if (line.trimStart().startsWith('{'))` branch in `apps/extension/src/components/Chat/chatbot.ts` fails `renders an envelope that arrives as a complete line mid-stream` while the end-of-stream case keeps passing, which is exactly the shape of the regression.

## Environment scaffolding used (not part of the PR)

- `deploy/local/.env`, `.env.web`, `.env.extension` were **symlinked** into the worktree so Prisma and the web suite could resolve local configuration. No secret file was read, printed, or copied, and all links are gitignored.
- `pnpm api -- gen:model` was run to generate the Prisma clients, with `XDG_CACHE_HOME` redirected to the gitignored `.local/xdg-cache` because the sandbox denies writes to Prisma's engine cache outside the workspace.

## Runtime probe in workerd — what it does and does not show

The server fix rests on a runtime assumption: that awaiting `close()` **inside** the `waitUntil` task is what keeps the stream alive, where the old `void close()` let the task settle first. To test that assumption without credentials, a throwaway worker (gitignored scratch config) reproduced the exact shape — `TransformStream` + `ctx.waitUntil(task)`, returning the readable immediately, with `/awaited` and `/void` variants — and both were called over real HTTP through local `wrangler dev` (workerd).

Result: **both variants delivered the complete 64-byte frame and terminated cleanly.**

That is a negative result worth recording: local workerd does not reproduce the production isolate-teardown race, so the awaited-close guarantee is pinned by the unit-level ordering assertions in `apps/api/test/domain/aigcChatStream.test.ts` — which were shown to fail against the old shape — rather than by any local runtime reproduction. It also means a local browser pass cannot act as a negative control: run against the pre-fix code it would most likely have shown the frame too. A local pass confirms the fixed path; it does not demonstrate the production hang.

## Local pre-push review (REVIEW.md three passes)

The diff changes observable behavior and touches `apps/**` and `packages/**`, so the OpenSpec flow applies. Several changes are active in `openspec/changes/`; the change-id resolves to `chat-error-observability` as the only one whose proposal and delta specs describe this diff.

**Bugs — no Important findings.** Nits:

- `writer.getWriter()` sits outside the `try` in `bookmarkChat`, so the termination guarantee does not formally cover a throw from `getWriter()` itself. Unreachable in practice: the controller always passes a fresh, unlocked `TransformStream`.
- A failure inside a tool call (for example the browser tool's fetch) carries no HTTP status, so it now classifies as `AI_PROVIDER_UNAVAILABLE` ("temporarily unavailable"). Slightly imprecise, but the logged cause disambiguates it and it is no worse than the previous single generic failure.
- `this.wr` and `this.chunks` remain shared fields on the singleton service, so two concurrent chats on one isolate can interleave content frames. Pre-existing and orthogonal; the termination guarantee was made immune to it by capturing the local writer.
- `MultiLangError.getMessage` reads a module-global language, so concurrent requests in different languages can render each other's message language. Pre-existing.

**Security — no Important findings.** Provider internals (status, code, reference, overload flag) reach logs only; the client receives the localized message plus a numeric code, with no credential, raw provider payload or stack trace. Only extracted scalar fields and the provider message string are logged, never the raw error object, and the API key is read solely from `env.VERTEX_API_KEY` and never placed in a log line or a response. The error frame is JSON-encoded, so it cannot inject into the client's parser. No authentication or authorization surface is touched.

**Compliance — intent matches the change.** Tasks 1–7.4 are implemented; 7.2/7.3 are explicitly unperformed with their reasons recorded above. Three divergences between the planning artifacts and the implementation were found during implementation and reconciled inside this change rather than left to rot: the D6 mechanism (a terminal `.catch()/.finally()` chain instead of awaiting the consumer inside `chat()`, which would change `chat()`'s contract and the timing every existing client test relies on), the "empty stream" rule (no output at all, because tool-only requests legitimately finish without assistant content), and the proposal's wording for that same rule. `openspec validate --all --strict` passes.

## Recorded follow-ups (deliberately not in this change)

The repository's automated PR review ran three times against successive heads. Its first two runs raised no Important findings; the third escalated the extension consequence to Important, because shipping the new framing without touching that client would have degraded a shipped surface. That finding is **fixed** in this change (design D9, task 5.7/6.7) rather than deferred. The remaining items below are real but out of scope, and are recorded in `design.md`'s Non-Goals:

1. **Pre-stream quote-image stall.** `buildQuotePayload` awaits an un-timed `fetch` per quoted image before the idle ceiling is armed, so a host that never answers can still leave the chat loading with no message.
2. **No cancellation on surface teardown.** `destruct()` clears the callback but the in-flight stream runs to completion or to the idle bound.
3. **Summary stream.** `AigcService.bookmarkSummary` carries the same un-awaited `write`/`close` pattern as the chat path did.
4. **The rest of the extension client's defects.** It still has no termination guarantee on a read failure and none of the un-timed waits the web client just gained; only the error-frame parse was fixed here.

## Not verified

**Manual browser end-to-end** (tasks 7.2/7.3). The operator stopped the `eink-code-highlight` worktree's dev servers, so the ports are free, but the stack still cannot be brought up from this session: the generated configs carry `remote = true` on the Vectorize bindings (`script/deploy/config.ts:212`), so `wrangler dev` requires a `CLOUDFLARE_API_TOKEN` that a non-interactive shell cannot supply and that this session must not obtain. The chat route additionally requires a credential — a JWT signed with `env.JWT_SECRET_TEXT`, an edge identity header carrying `env.EDGE_SHARED_SECRET`, or a database API key — so an authenticated chat request cannot be constructed without reading a secret file, and there is no local-dev auth bypass in `middleware/auth.ts`.

What covers the same ground without credentials: `apps/api/test/handler/http/aigcChatStream.test.ts` drives the real controller, real service and a real failing provider client and reads the resulting `Response` body (stream ends + envelope delivered); `apps/web/tests/unit/utils/chatbot.spec.ts` covers every client termination path. Neither is a substitute for a human pass in the browser, and per the probe above a local browser pass should be treated as confirmation of the fixed behavior rather than as a reproduction of the original hang.

