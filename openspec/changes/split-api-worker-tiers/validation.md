# Validation: split-api-worker-tiers

Work runs in the isolated worktree on `perf/split-api-worker-tiers`, cut from `origin/dev` `ffd5ae00`. A second detached worktree at the same revision serves as the baseline for every comparison below. No remote deployment, account mutation or Cloudflare write was performed; all Cloudflare reads quoted in the proposal were read-only.

## Automated checks (2026-11-20)

| Check | Baseline (`origin/dev`) | This change |
|---|---|---|
| `npx tsc --project tsconfig.json --noEmit` (apps/api) | passes | passes |
| API ESLint | 0 errors, 344 warnings | 0 errors, 335 warnings |
| Full API Vitest | 272 files, 4343 passed, 167 skipped | 278 files, 4454 passed, 167 skipped, 0 failed |
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

## Runtime values, bindings and entries per Worker (2026-11-20)

The change requester asked whether the split affects `ctx.env`, secrets or the behavior of each entry. Each Worker's built bundle (metafile inputs with bytes in output) was scanned for `env.X` reads and compared with its generated configuration and, read-only and by name only, with the live script settings of production, beta and test. No secret value was read.

- **Bindings.** Every binding a bundle reads is in its generated configuration, except that `browserConfig` dropped the Browser Worker's `BROWSER` binding (a defect introduced in this change; `origin/dev` kept it). Fixed and covered in `deployPaths.test.ts`. Core's `VECTORIZE1..5` are fallbacks only when `VECTOR` is absent; Core binds `VECTOR`, as `origin/dev` did.
- **Secrets.** Deploys use `--keep-vars`, so secrets set with `wrangler secret put` stay on their original script. `DEEPSEEK_API_KEY` exists only on the old Edge in production and beta; the YouTube article and podcast Workflows that read it move to Core, and AI reads it too, so those Workflows would fail after step 2. The test account has 17 Core and 5 AI keys only on the old Edge. Added `script/deploy/runtimeKeys.ts`, a bundle-derived test keeping it exact, and a check (`missingRuntimeValues`) that stops steps 1 to 3 and normal releases while a Worker lacks a key another API Worker holds and `[vars]` does not publish. Run read-only against the three environments, it reported exactly these keys (plus `FRONT_END_URL` for Objects, which the real `[vars]` publishes). Keys held by no Worker (for example `APP_STORE_*` and `TELEGRAM_WEBHOOK_SECRET` in production) are unconfigured today and are not reported.
- **Synchronizing values.** Every lost value is a `secret_text` (none is a plain variable published by `[vars]`), and Cloudflare never returns a secret's value, so it cannot be copied between scripts. `pnpm api -- secrets:sync --from <file> [--dry-run]` reads the values from an operator-held `.env` or JSON file (refused inside the repository unless git-ignored), uploads to each Worker only the keys it lacks through `wrangler secret bulk` on stdin, never overwrites an existing secret and skips Workers not yet deployed. Wrangler 4.127.1 source shows `secret bulk` updates secrets without redeploying code but creates a draft Worker when the script is missing, hence the skip. `syncSecrets.test.ts` covers selection, dry run, absent keys, undeployed Workers, value redaction in output and the file location rule. Not run against a real account.
- **Entries.** The six Workflow bodies and `contentHandler` differ from `origin/dev` only in the generated-registry import path. Edge's forwarding (identity, shared secret, ray ID, Authorization stripping) is unchanged; AI now receives 13 routes instead of 5 through the same middleware chain (CORS, auth, request log, rate limit) as Core, so authentication, allowlists and limits apply as before. `ContentEntry` still forwards to `CORE`. Objects reads only `BROWSER`, `OSS`, `DB`, `HYPERDRIVE` and `FRONT_END_URL`, all bound.

## Running environment

`pnpm api -- test:http` passed (`HTTP acceptance: passed`) with local Edge, Core, AI and Objects started together by `dev:local`, against disposable PostgreSQL (`postgres:17-alpine`), D1 and R2 with historical migrations. It exercised login and JWT rejection, bookmarks, Feed, newsletter addresses and delivery, envelope rejection, owner revocation, diagnostics and snapshot AI through the AI Worker's handlers. Newsletter email entered through the smoke-only Edge fixture (`test/runtime/edgeEmailFixture.ts`), which forwards the untouched message to Core's real `email()` handler. A minimal two-Worker experiment showed `wrangler dev` 4.127.1 delivers its local email trigger only to the primary Worker and ignores `MF-Route-Override` and routes for it, while a forwarded `env.CORE.email(message)` preserves recipient, body and reject reason. Production Email Routing will deliver to Core directly after transition step 3.

Two real defects were found in this run and fixed. First, both tier registries registered `DatabaseRegistry` in the shared container, so with two tiers loaded in one isolate the second replaced the first and Core lost providers; each tier now keeps its registry in its own module. Second, `setup` required both Hyperdrive bindings on every Worker; it now checks the bindings each Worker owns.

`FORK_SMOKE=1 pnpm api -- test:http` fails at `test/runtime/forkSmoke.ts:654` (`'failed' !== 'success'`). The same command on the `origin/dev` baseline worktree fails at the same line with the same assertion, so this is a pre-existing failure outside this change and was not modified.

## Additional local suites against the baseline (2026-11-20)

Run on this change and, with identical commands, on the `origin/dev` baseline worktree.

| Suite | This change | Baseline |
|---|---|---|
| `pnpm api -- test:integration:local` (historical PostgreSQL and logs migrations, Collection pagination and triggers, tags, Labs, payment, account revocation) | 10/10 passed | not rerun |
| Integration tests skipped by default (`RUN_PG_INTEGRATION_TESTS`, `FORK_TEST_DATABASE_URL`, `NEWSLETTER_LOCAL_PG_TEST`, `PASSKEY_LOCAL_PG_TEST`, `PASSKEY_REDIS_TEST`) against a disposable migrated PostgreSQL | 86 passed; `bookmarkFork.integration` "deletes only the removed account managed bundles and tolerates R2 deletion failure" fails; `passkeyChallengeRedis.integration` fails in its Redis fixture | identical: same 86 pass, same two fail |
| `pnpm api -- test:setup:local` (PowerSync) | fails: `powersync-api` container restarts | identical failure |
| `pnpm api -- test:http` (rerun on the final code) | passed | — |

The three failures are pre-existing and unrelated to the Worker split; they are not modified here.

## Local dev with remote test-account resources, against the baseline (2026-11-20)

The change requester pointed out that local `pnpm api -- dev` uses remote bindings on the test account (`[env.dev]` of `deploy/local/api.toml`: the v5 and shard Vectorize indexes, Browser Rendering, the event Pipeline, Workers AI), so cloud flows can run locally. Both versions ran `pnpm api -- dev` with that configuration, the operator's `.dev.vars` (linked, never read) and their own copy of the same local state snapshot (D1, R2, KV, Durable Objects, Workflows), against the shared local PostgreSQL and PowerSync. The new code ran five Workers, the baseline four; AI moved to port 8798 because another process held 8788 (`SLAX_API_DEV_PORTS`, added for this). Requests used a login token signed for a seeded user and went through Edge.

- **54 GET routes:** identical HTTP status and response code on both versions. Two routes return 500 on both (`/v1/user/notifications` without parameters; `/v1/user/passkey`, whose table is absent from the local database).
- **Writes and AI:** tag create, `add_url`, star/unstar, API key create, hybrid search (SSE, jieba plus remote Vectorize), bookmark search (full text plus vector hits), overview and outline (real Gemini streams), chat (403 `NOT_SUBSCRIPTION` for this user on both), article and collection recommendations (remote v5 indexes): identical on both.
- **Bookmark pipeline:** `add_url` for a real page ran Crawl Workflow → content validation Workflow → full-text record → semantic normalize and remote Vectorize upsert → screenshot through `ScreenshotBrowser` (Objects on the new code) and remote Browser Rendering into R2, ending `success` with 732 words on both. One of three new-code runs lost the remote browser session ("Network connection lost"); the other two saved screenshots. `vector_mutation_not_visible` and `missing_vector_preference_object` (no `VECTOR_V5_PREFERENCE` in the local configuration) appear on both versions.
- **WebSocket, API key, cron:** `/v1/user/messages` upgraded (101) through Edge to `SlaxWebSocketServer` and delivered the reminder frame on both; an API key read the bookmark list and was refused (403) on a route outside its allowlist on both; the `*/5` cron ran on Core (new) and Edge (baseline), each hitting the same local-schema error in a media-article query.
- **Cleanup:** the five bookmarks, three tags and one API key created in the shared local PostgreSQL were deleted in one transaction, with their dependent rows; the worktrees' own local state was restored and the snapshots removed. Remote Vectorize received test vectors for those bookmarks in the test account's indexes.

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
