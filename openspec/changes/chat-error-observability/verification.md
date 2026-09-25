# Verification

Evidence gathered for `chat-error-observability` in worktree `.local/worktrees/chat-error-observability` (branch `fix/chat-error-observability`), on top of `dev` @ `cfa8786`.

## Baselines

Every check was compared against a clean tree so pre-existing failures are not attributed to this change.

| Check | Changed tree | Clean baseline | Conclusion |
| --- | --- | --- | --- |
| `pnpm api -- test` | 149 passed / 0 failed (1650 tests), 158 files | main checkout: 145 passed / 1 failed (missing `@electric-sql/pglite`), 155 files | No failures introduced; the 3 added files are the new suites. The worktree's own run is fully green because its install resolves `pglite`. |
| `pnpm api -- typecheck` | 120 errors | 120 errors, byte-identical multiset; main checkout: 0 errors | The 120 are missing-generated-Prisma-client noise in this fresh worktree, present identically with the change applied and stashed, and none touches a changed file. |
| `pnpm web -- typecheck` | exit 0, clean | n/a | No errors. |
| `pnpm web -- test` | 12 failed files / 109 failed tests | main checkout: 13 failed files / 118 failed tests | The changed tree's failing-file set is a **strict subset** of the baseline's (the only difference is `tests/unit/utils/mermaid.spec.ts`, unrelated to this diff). No new failures. Neither `chatbot.spec.ts` nor `SnapshotChatPanel.spec.ts` is in either failing set. |
| API lint (changed files) | 15 warnings | 15 warnings, identical multiset | Zero new warnings; the previous "18" counted three `File ignored` notices. |
| Web lint (`chatbot.spec.ts`) | 1 error, 0 warnings | 1 error, 0 warnings | Back to the baseline's single pre-existing import-sort error after an intermediate version briefly added one. |
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

## Environment scaffolding used (not part of the PR)

- `deploy/local/.env`, `.env.web`, `.env.extension` were **symlinked** into the worktree so Prisma and the web suite could resolve local configuration. No secret file was read, printed, or copied, and all links are gitignored.
- `pnpm api -- gen:model` was run to generate the Prisma clients, with `XDG_CACHE_HOME` redirected to the gitignored `.local/xdg-cache` because the sandbox denies writes to Prisma's engine cache outside the workspace.

## Runtime probe in workerd — what it does and does not show

The server fix rests on a runtime assumption: that awaiting `close()` **inside** the `waitUntil` task is what keeps the stream alive, where the old `void close()` let the task settle first. To test that assumption without credentials, a throwaway worker (gitignored scratch config) reproduced the exact shape — `TransformStream` + `ctx.waitUntil(task)`, returning the readable immediately, with `/awaited` and `/void` variants — and both were called over real HTTP through local `wrangler dev` (workerd).

Result: **both variants delivered the complete 64-byte frame and terminated cleanly.**

That is a negative result worth recording: local workerd does not reproduce the production isolate-teardown race, so the awaited-close guarantee is pinned by the unit-level ordering assertions in `apps/api/test/domain/aigcChatStream.test.ts` — which were shown to fail against the old shape — rather than by any local runtime reproduction. It also means a local browser pass cannot act as a negative control: run against the pre-fix code it would most likely have shown the frame too. A local pass confirms the fixed path; it does not demonstrate the production hang.

## Not verified

**Manual browser end-to-end** (tasks 7.2/7.3). The operator stopped the `eink-code-highlight` worktree's dev servers, so the ports are free, but the stack still cannot be brought up from this session: the generated configs carry `remote = true` on the Vectorize bindings (`script/deploy/config.ts:212`), so `wrangler dev` requires a `CLOUDFLARE_API_TOKEN` that a non-interactive shell cannot supply and that this session must not obtain. The chat route additionally requires a credential — a JWT signed with `env.JWT_SECRET_TEXT`, an edge identity header carrying `env.EDGE_SHARED_SECRET`, or a database API key — so an authenticated chat request cannot be constructed without reading a secret file, and there is no local-dev auth bypass in `middleware/auth.ts`.

What covers the same ground without credentials: `apps/api/test/handler/http/aigcChatStream.test.ts` drives the real controller, real service and a real failing provider client and reads the resulting `Response` body (stream ends + envelope delivered); `apps/web/tests/unit/utils/chatbot.spec.ts` covers every client termination path. Neither is a substitute for a human pass in the browser, and per the probe above a local browser pass should be treated as confirmation of the fixed behavior rather than as a reproduction of the original hang.

