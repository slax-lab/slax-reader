# Validation

## Scope and approval

The change requester asked on 2026-11-17 to re-check the diagnosis, fix the outline/summary caching defect and open a task PR. Production access during diagnosis was read-only; no production row, Worker, configuration or migration was changed. The change touches only `apps/api` runtime code and tests; no CLI, Extension, Mobile or Web code, shipped UI, shared package, contract, dependency or build configuration changes, so the package-version question does not apply.

## Production diagnosis (read-only)

- `reader-ai` Workers Observability, last 7 days: 6 error events with `at VertexAIClient.chatStream (index.js:3334:26112) at async AigcService.bookmarkSummary (index.js:3340:350)`. Trace `446ed893a2d47d84e471389c7732aaca` is a `POST /v1/aigc/summaries` request of 15.78 s ending in that error.
- `sr_bookmark_summary` (6,002 rows): 7 rows with `content = ''`, all created in the last 30 days, each created in the same millisecond as a failure event (for example `2026-11-17 07:11:56.416 UTC`). No row contains the stream's error text. A row updated in the same millisecond as a failure ends inside an unclosed anchor link, i.e. a partial outline was stored.
- The code path was confirmed against the imported history: the save-in-`finally` pattern predates the monorepo import, and the earlier chat stream fix did not cover summary generation. `AigcService` is resolved from a per-request container clone, so cross-request sharing of its fields was ruled out as a cause.

## Running-environment evidence

- Real `AigcController` and `AigcService` over real Web Streams in the Workers test runtime, with only the provider and storage faked (`test/domain/aigcSummaryPersistence.test.ts`, "POST /v1/aigc/summaries recovers after a failed generation"):
  - the first request streams `# Partial` and then fails; nothing is stored;
  - the second request generates again, streams the full outline and stores exactly what was streamed;
  - the third request is served from the cache without generating;
  - a pre-existing empty row is regenerated and replaced.
- A client cancellation is exercised with a real `TransformStream` whose readable side is cancelled before generation: nothing is stored.
- `FORK_SMOKE=1 pnpm api -- test:http` with local Edge/Core Workers, PostgreSQL in Docker (OrbStack) and R2, and a deterministic provider transport: `POST /__fixture/snapshot-ai/outline`, `/overview` and `/chat` returned 200 with generated content in both rounds, so the outline path still generates and streams after this change.

## Automated checks

- New tests fail on the previous code: with `apps/api/src` reverted to `origin/dev`, 13 of the new cases fail (persistence on failure, partial persistence, cancellation, `completed` reporting, empty rows listed or served, empty cache hit) and pass with this change.
- `pnpm api -- gen:all`: passed using `SLAX_API_SKIP_DOTENV=1`, `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example` and loopback placeholder database URLs for client generation only. No tracked generated output changed.
- `pnpm api -- test` (run with `SLAX_API_CONFIG`, `HYPERDRIVE_DATABASE_URL` and `LOGS_DATABASE_URL` unset): 271 files passed, 20 skipped; 4,284 tests passed, 158 skipped, zero failures.
- `pnpm api -- test test/script/layerArchitecture.test.ts`: 35 passed; no baseline entry was added.
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: zero errors; the 346 warnings predate this change.
- Prettier check of every changed source and test file, and `git diff --check`: passed.
- `pnpm exec openspec validate --all --strict`: 141 passed, zero failed.
- `pnpm api -- build` with the public template: all four Worker bundles passed with Wrangler `--dry-run`; nothing was deployed.

## Gaps and boundaries

- The full `FORK_SMOKE=1` HTTP smoke did not finish: it fails later in the media-snapshot R2 retry check (`forkSmoke.ts:585`, expected `success`, got `failed`) with local `missing_vector_maintenance_workflow` errors. The same smoke on the unchanged base commit `4c4925a1` fails earlier (`POST /v1/bookmark/add_url` times out, with local `deleteByIds` errors), so the failure is pre-existing local-environment behaviour unrelated to outline caching. All AI steps of the smoke passed.
- No live Vertex AI call was made: forcing a real provider failure requires production credentials, and the provider failure is reproduced deterministically through the real streaming code instead.
- The fix was not deployed and was not exercised on the deployed `reader-ai` Worker; that happens through the normal release flow.
- Existing stored rows are not modified. The 7 empty rows become cache misses and are replaced by the next successful generation; rows that were stored truncated keep their content until the user regenerates. Cleaning them up is a separate, explicitly authorized data change.
- No UI presentation changes, so no hands-on visual acceptance applies.

## Local review

Completed the three `REVIEW.md` passes against this branch's diff and the `skip-failed-outline-cache` artifacts on 2026-11-17. No Important findings.

- Bugs: persistence happens only after the provider stream resolves and only for non-empty text; the error write and close are awaited and their failures are logged without masking the original error; a failed or cancelled stream skips the save. Successful responses stream and store byte-identical text, preserving the existing `bookmark-ai-outline` pass-through requirement. Cache reads treat empty and whitespace-only rows as absent on every read path that serves them (`/v1/aigc/summaries`, the owner outline stream, the summary list, and the owner outline for read-only viewers and the detail trace). Read-only viewers still never generate. The removed `recordChunks` had no other caller. Comments match the code.
- Security: no new dependency, secret, network destination, log field, migration or data write. Logs contain only the existing error objects.
- Compliance: the implementation matches the proposal and the delta spec scenarios, every task is implemented, and the PR targets `dev` with `OpenSpec: skip-failed-outline-cache`. Naming, placement and layer responsibilities follow the existing call chain: the domain decides when to persist, the handler decides cache hits, and the repository filters rows; no new layer, abstraction, retry, TTL or configuration was added.
