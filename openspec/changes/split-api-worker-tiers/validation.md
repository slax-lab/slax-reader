# Validation: split-api-worker-tiers

Work runs in the isolated worktree on `perf/split-api-worker-tiers`, cut from `origin/dev` `ffd5ae00`. A second detached worktree at the same revision serves as the baseline for every comparison below. No remote deployment, account mutation or Cloudflare write was performed; all Cloudflare reads quoted in the proposal were read-only.

## Automated checks (2026-11-20)

| Check | Baseline (`origin/dev`) | This change |
|---|---|---|
| `npx tsc --project tsconfig.json --noEmit` (apps/api) | passes | passes |
| API ESLint | 0 errors, 344 warnings | 0 errors, 335 warnings |
| Full API Vitest | 272 files, 4343 passed, 167 skipped | 277 files, 4439 passed, 167 skipped, 0 failed |
| Root tooling `node --test tooling/*.test.mjs` | not rerun | 282 passed, 2 skipped, 0 failed |
| `test/script/layerArchitecture.test.ts` | passes | 45 passed; baseline keys renamed for moved files only, no count raised, no entry added |

Generators were rerun (`gen-cron`, `gen-consumer`, `gen-routers`, `gen-di`, then Prettier) and the committed generated files are their output. The generated routers serve the same 148 routes as `origin/dev` without MCP, in the same order: 135 in `generated/core/readerRouter.ts` and the 13 `AI_ROUTES` in `generated/ai/aiRouter.ts`. The Core registry holds 117 classes and 19 providers, the AI registry 40 classes and 12 providers.

New or extended tests and what each was shown to catch:

- `workerTopology.test.ts` builds all five Workers with the published template (minified, offline) and checks the D8 module rules from the metafiles. Temporarily exporting `PasskeyService` and `SlaxJieba` from the AI entry made it fail, naming `src/domain/passkey.ts`, `@simplewebauthn/server` and the jieba WebAssembly file; the entry was restored.
- `tierContainers.test.ts` resolves every class the generated dispatch and entry modules look up in each tier, and checks that every token a registration resolves (lazy ones included) is registered or provided. Removing `provideGEMINI_AGENT` from the AI registry made it fail with `['GEMINI_AGENT']`; the file was restored and regenerated.
- `layerArchitecture.test.ts` adds the `tier-registry` rule: only `src/entry/<tier>/**` and the tier's own generated modules may import `src/di/generated/<tier>/**`, covered by seven violation and four allowed cases.
- `generatorPaths.test.ts` rejects a controller serving both Workers and an `AI_ROUTES` entry without a handler before writing, and asserts the four vector refresh routes appear only in the AI router.
- `topology.test.ts` runs the readiness check and all four transition steps against an in-memory account. It shows Edge consumers and schedules are removed before Core is published, every step can be repeated, dry runs make no write, step 2 refuses to run before Objects exists and fails when Core does not take ownership, and the API client reports error codes without response bodies.
- `devLocal.test.ts` covers the four-Worker launcher, its allowed service and Durable Object directions, the Core-only Workflow and the fixture opt-in.
- `edge.test.ts` adds trailing-slash dispatch: `isAiRoute` strips trailing slashes as itty-router matching does, a mismatch found and fixed during this change.

## MCP namespace deletion (2026-11-20)

The change requester asked for the `SlaxMcpServer` namespaces to be deleted completely rather than kept behind a stub. Read-only queries found six namespaces (production `slax-read-backend`, `slax-read-backend-beta`, `reader-core`, `reader-core-beta`; test `reader-backend`, `reader-core`) and `MCP_OBJECT` bindings from beta and test Edge to Core. Live migration tags are Core `vector-preference-v1` everywhere and Edge `v2`/`v3`/`v4`. Wrangler 4.127.1 source (`getMigrationsToUpload`) applies only steps after a listed live tag, and every listed step when the live tag is absent; Cloudflare's documentation states a namespace is deleted only when its class is not exported and no other Worker binds it.

- Generated configuration per phase, checked with a Wrangler dry run against a history containing `SlaxMcpServer`: steady Core has tags `v1 v2 vector-preference-v1 retire-mcp-v1` and the normal entry; step 2–3 Core has the history without `retire-mcp-v1` and `src/entry/transition/core.ts`; step 3 Edge has no migrations and `src/entry/transition/edge.ts`; step 4 Edge has only `retire-mcp-v1` and the normal entry. All four bundle.
- `deployPaths.test.ts` covers each phase, histories that already delete or never created the class, and the per-phase entry file. `topology.test.ts` shows steps 1 to 3 delete nothing, step 4 refuses to run while ownership is incomplete, publishes Edge before Core (the fake account rejects Core first, as Cloudflare does), verifies no namespace remains, is idempotent, and that a remaining namespace blocks normal releases. A namespace of the same class on an unrelated script is ignored.
- Not exercised: the deletion on a real account, which is part of task 8.3.

## Running environment

`pnpm api -- test:http` passed (`HTTP acceptance: passed`) with local Edge, Core, AI and Objects started together by `dev:local`, against disposable PostgreSQL (`postgres:17-alpine`), D1 and R2 with historical migrations. It exercised login and JWT rejection, bookmarks, Feed, newsletter addresses and delivery, envelope rejection, owner revocation, diagnostics and snapshot AI through the AI Worker's handlers. Newsletter email entered through the smoke-only Edge fixture (`test/runtime/edgeEmailFixture.ts`), which forwards the untouched message to Core's real `email()` handler. A minimal two-Worker experiment showed `wrangler dev` 4.127.1 delivers its local email trigger only to the primary Worker and ignores `MF-Route-Override` and routes for it, while a forwarded `env.CORE.email(message)` preserves recipient, body and reject reason. Production Email Routing will deliver to Core directly after transition step 3.

Two real defects were found in this run and fixed. First, both tier registries registered `DatabaseRegistry` in the shared container, so with two tiers loaded in one isolate the second replaced the first and Core lost providers; each tier now keeps its registry in its own module. Second, `setup` required both Hyperdrive bindings on every Worker; it now checks the bindings each Worker owns.

`FORK_SMOKE=1 pnpm api -- test:http` fails at `test/runtime/forkSmoke.ts:654` (`'failed' !== 'success'`). The same command on the `origin/dev` baseline worktree fails at the same line with the same assertion, so this is a pre-existing failure outside this change and was not modified.

## Bundle size and startup CPU

Built with the published template, `--minify`, Wrangler 4.127.1 (the repository's version). Startup CPU is the busy time in `wrangler check startup` profiles (Wrangler 4.165.0, outside the repository), seven runs each; the median is the fourth value.

| Worker | Upload, baseline | Upload, this change | Startup CPU runs, baseline (ms) | Startup CPU runs, this change (ms) | Median |
|---|---|---|---|---|---|
| Edge | 16.0 MiB | 89 KiB | 229 251 260 262 268 282 338 | 17.5 18.1 18.1 23.8 24.5 45.6 45.7 | 262 → 24 |
| Core | 16.0 MiB | 9.9 MiB | 228 230 232 233 254 264 341 | 90 92 95 96 108 114 176 | 233 → 96 |
| AI | 16.0 MiB | 5.9 MiB | 225 242 262 272 282 291 291 | 62 64 66 68 70 86 108 | 272 → 68 |
| Objects | — | 4.0 MiB | — | 17.6 22.5 22.7 23.2 23.7 23.8 34.2 | 23 |
| Browser | unchanged | 335 KiB | — | — | — |

`unpdf` no longer reaches AI after `readPdfBody` moved to `src/utils/pdfBody.ts`; AI's upload is unchanged because the PDF text library was already a dynamic import, so this removes a dependency, not bytes.

## Not verified, and why

- Task 8.2 items that need cloud services or bindings absent from the local fixture: Vectorize and the vector maintenance Workflow (local runs log `missing_vector_maintenance_workflow` and an unbound Vectorize shard, as the baseline does), Browser Rendering screenshots, a jieba-backed search through real D1 fulltext, queue delivery and cron ticks in Miniflare, a WebSocket upgrade through Objects, and an API-key route. Unit and integration tests cover their code paths; a running exercise awaits the test account (8.3).
- Task 8.3 (transition on the test account, Workflow instance progress, per-colo Core wall time) requires operator authorization and has not been run.
- Production latency from Singapore and the United States is expected to improve with placement, but no remote measurement has been taken.

## Local pre-push review (REVIEW.md)

**Bugs.** Checked tier dispatch (trailing slashes, the 148-route parity), DI closure completeness including lazy tokens, registry isolation when two tiers share an isolate, Workflow and queue ownership, the binding sets each target keeps, and the transition order. Two defects found by the running environment are fixed (registry replacement across tiers; per-Worker Hyperdrive requirement in setup). Review found the readiness check read only the first page of Workflows and queues, which could hide an Edge consumer on an account with more than 100 entries; the client now reads every page, with a test. `--transition` skips the readiness check and is passed only by `topology:transition`, whose steps check their own preconditions.

**Security.** No new dependency is added; `agents`, `@modelcontextprotocol/*`, `moment-timezone` and `zod` are removed. The attribution parser replacing zod drops unknown keys and keeps every bound (unit tests plus the 31-case equivalence run). The Cloudflare client sends the token only to `api.cloudflare.com` for the configured account and reports error codes without response bodies. Local tooling keeps rejecting remote resources, secret files and non-loopback databases; the smoke-only Edge email fixture is accepted only with `SLAX_API_DIAGNOSTIC_HTTP_FIXTURE=1`. The retired Durable Object stubs carry no behavior beyond a 410.

**Compliance.** The implementation matches proposal, design D1 to D11 and the delta specs; tasks marked complete are implemented and verified above. The layer baseline changed only by renaming keys of moved files at unchanged counts. Open items are 8.2 (cloud-bound flows), 8.3 (test-account transition, needs operator authorization) and 8.4's version question.

No Important findings remain. Nit: `--transition` is an internal flag visible in `deploy`'s argument list.
