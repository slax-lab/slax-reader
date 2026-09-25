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

## Not verified

**Manual browser end-to-end** (tasks 7.2/7.3). The local dev servers on ports 8787/8788/3000 are running from the `.local/worktrees/eink-code-highlight` worktree (PR #158), which this objective explicitly forbids touching; exercising a browser reproduction of this change would require stopping that worktree's servers and standing this branch's full stack up in their place, and the chat endpoint additionally needs a live subscription session whose credentials live in ignored secret files. The `apps/api/test/handler/http/aigcChatStream.test.ts` suite drives the real controller, real service and real failing provider client and reads the resulting `Response` body, covering the same boundary deterministically (stream ends + envelope delivered), but it is not a substitute for a human pass in the browser.
