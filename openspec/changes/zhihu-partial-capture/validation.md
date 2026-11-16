# Zhihu Partial Capture Validation

## Scope and approval

- Date: 2026-11-15 (Asia/Shanghai).
- Change: `zhihu-partial-capture`.
- Worktree: `/Users/daguang/project/slax-reader/.local/worktrees/zhihu-partial-capture`.
- Branch: `feat/fix-zhihu-parse` (renamed at the user's request from `fix/zhihu-partial-capture`), created from `origin/dev` at `8f534c21`.
- The user approved implementation after the proposal was prepared.
- Implementation was committed and PR #614 was opened at the user's request. This record now includes subsequent local Reader verification and human acceptance; no deployment or production replay was performed.

## Implemented behavior

Zhihu question detail and answer-list requests settle independently. Successful content is retained while only failed provider calls are retried, with at most four attempts and waits of 1, 2, and 4 seconds. Each attempt has a 20-second timeout covering the response body. Exhausted components are omitted without repeating successful calls. Captures without usable content fail rather than publish an empty snapshot. Selected-answer identity is preserved; unrelated answers are never substituted. Other platforms retain their existing behavior. Partial captures are not automatically enriched later.

A typed no-content/exhaustion error is terminal at the workflow fetch boundary, preventing outer workflow retries from multiplying provider attempts. Unexpected errors retain the existing workflow retry policy. Parsing failures already have terminal `parse_failed:` semantics; this change preserves them and verifies that they do not refetch successfully obtained Zhihu content.

## Automated checks

Commands were run from the task worktree, or from its `apps/api` directory for direct Vitest commands.

| Check | Command | Result |
| --- | --- | --- |
| Focused adapter and workflow regression | `pnpm exec vitest run --config vitest.config.ts --silent=true test/infra/zhihuCapture.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts` | 2 files passed; 145 tests passed (49 adapter, 96 workflow). |
| Full API regression | `SLAX_API_SKIP_DOTENV=1 pnpm api -- test --silent=true` | 251 files passed, 17 skipped; 4,022 tests passed, 146 skipped. This run preceded addition of the separate runtime test below. |
| Type checking | `SLAX_API_SKIP_DOTENV=1 pnpm api -- typecheck` | Passed. |
| Lint | `SLAX_API_SKIP_DOTENV=1 pnpm api -- lint` | Passed with 0 errors and 343 existing warnings. |
| Build | `SLAX_API_SKIP_DOTENV=1 pnpm api -- build --config deploy/cloudflare/api.toml.example` | Core, edge, AI, and browser Wrangler dry-run bundles passed; no deployment. Existing contracts side-effects warnings remained. |
| OpenSpec | `pnpm exec openspec validate --all --strict` | 132 validations passed; 0 failed. |
| Runtime save/read verification | `pnpm exec vitest run --config vitest.config.ts --silent=true test/infra/zhihuCapture.runtime.test.ts` | 1 test passed, exercising all four scenarios below; approximately 25 seconds, completed after the full API suite. |
| Patch whitespace and formatting | `git diff --check`; `pnpm exec prettier --check` and `pnpm exec eslint` on the new files | Passed. `git diff --check` covers tracked files only, so the new files were checked with Prettier and ESLint separately. |

Dependencies were installed with the frozen lockfile. Prisma clients were generated into ignored dependency output for local verification, without connecting to a database or running migrations. The lockfile was unchanged. Runtime harness resolution failures were corrected by selecting Workerd package exports and registering bundled WebAssembly modules; production code was not changed to accommodate the harness.

## Runtime save/read evidence

The runtime test executes the production adapter, `CrawlService`, `MediaSnapshotService`, and `SnapshotBundle` under a real local Workerd runtime through Miniflare. Each successful capture is saved and read back through a separate Worker request using real local R2. Retry delays use real timers.

| Scenario | Question-detail calls | Answer-list calls | Save and read result |
| --- | ---: | ---: | --- |
| Answers only | 4 failed | 1 successful | Published once; read back answer content without the unavailable question description. |
| Description only | 1 successful | 4 failed | Published once; read back question description without unavailable answers. |
| Retry recovery | 3 (two failures, then success) | 1 successful | Published once; read back both recovered description and answers. |
| No usable content | 4 failed | 4 failed | Terminal typed failure surfaced as HTTP 422 by the test route; subsequent read returned 404; no publication or R2 objects. |

Successful snapshots contain the expected private snapshot representation. The three successful scenarios created exactly six R2 objects: HTML and text for each snapshot. Readback caused no additional provider requests. The unavailable scenario created none. The runtime was disposed after the test.

### Real and stubbed boundaries

- Real: Workerd execution, production capture/parsing/snapshot code, real backoff timing, local R2 writes, and separate-request snapshot readback.
- Controlled: TikHub responses are synthetic through a fetcher binding; no live credentials or billable provider calls are used. Unexpected outbound hosts are rejected.
- Stubbed: Database metadata, ownership, and publication repositories use explicit in-memory test doubles. This is not PostgreSQL integration evidence.
- Not exercised by this runtime test: authenticated application routes, the browser reader, production PostgreSQL, the deployed Cloudflare Workflow runtime, production TikHub availability, or end-to-end image rendering. Workflow retry and import-accounting behavior are covered separately by automated workflow tests, not by a deployed workflow.

## Review

### Bugs

Reviewed independent endpoint outcomes, bounded attempt and timeout handling, preservation of successful components, ordering and exact selected-answer identity, empty-content rejection, safe publication/readback, workflow termination, and import failure accounting. Existing terminal parsing behavior is preserved. No unresolved Important code issue was identified within the reviewed scope.

### Security

Reviewed the fixed provider host, identifier-based query construction, escaped metadata, and bounded allowlisted failure diagnostics. Tokens, headers, raw provider responses, and arbitrary provider error messages are not included in diagnostics. No new runtime dependency, migration, or external access surface was introduced.

### Compliance

The implementation follows the approved `zhihu-partial-capture` scope. Source changes are limited to API capture and workflow behavior, associated tests, and this change's planning/verification artifacts. No CLI, Extension, or Mobile package output is changed, so no client version increment is required by this diff. Agent-executable runtime evidence and its explicit gaps are recorded above. The requesting human completed hands-on Reader acceptance on 2026-11-16, with no adjustments requested. Acceptance occurred after PR #614 was opened; the original pre-PR gate was missed. The reviewed scenarios and this sequencing deviation are recorded below.

## Deferred review findings

The final local review raised the following items. At the user's direction they were deferred and not changed in this pull request:

- When every Zhihu component fails, the typed terminal error stops the workflow's existing one-minute outer retries. TikHub states failed requests are not billed, so those retries cost nothing; keeping them for all-failure cases may recover more captures.
- An HTTP 200 response with provider code 200 but an unexpected data shape is retried up to four times, and each retry may be billed. The live success shapes of question detail and answer detail were not observed, because both endpoints returned HTTP 400 during the investigation.
- The invalid-parameter pattern matches `id` inside words such as `valid`, so some transient messages are treated as terminal. This reduces retries; it does not add charges.
- Retry classification for the generic HTTP 400 depends on TikHub's current error text.

## Human reader acceptance — 2026-11-16

The requesting human reviewed the saved-content scenarios in the Reader and confirmed in this conversation on 2026-11-16 (Asia/Shanghai): "I checked the scenarios; no issues. Update the PR." No adjustments were requested. This is hands-on acceptance of the saved content, not proposal approval.

The acceptance setup used isolated local PostgreSQL with the existing migrations, local Workerd and R2, production `fetchZhihuByUrl`, `CrawlService.parseAndSaveZhihu`, `MediaSnapshotService`, and `SnapshotBundle`, and the application's actual Reader at `/b/<uuid>`. Metadata, ownership, and publication used the real repositories rather than the in-memory doubles used by the automated runtime test above.

Two fresh live TikHub answer-list requests for question `2092104476844999911` returned 20 answers each. Their responses were replayed without content changes at the provider boundary for the combined and answers-only captures. Question detail remained unavailable during the investigation, so, with the human's prior agreement, description content was explicitly labeled as simulated acceptance content rather than original Zhihu text. Blocked components returned controlled HTTP 400 responses; retry delays were real. No live answer request was needed for the description-only scenario.

| Reviewed scenario | Saved Reader UUID | Detail / answer attempts | Saved text characters | Result |
| --- | --- | --- | ---: | --- |
| Combined: labeled simulated description and real answers | `d2f3dbde-78e6-424e-927a-1111ca16dccb` | 1 / 1 | 12,151 | Both parts saved and readable. |
| Detail blocked: real answers only | `e525a88d-41ae-4e95-b7db-3a8b54a16ae2` | 4 / 1 | 12,071 | Answers retained; unavailable description omitted. |
| Answers blocked: labeled simulated description only | `9a15d720-545e-4b04-bb9b-6fff74234386` | 1 / 4 | 101 | Description retained; unavailable answers omitted. |

All three Reader pages and their saved-content endpoints returned HTTP 200; inclusion checks matched the expected presence or absence of description and answers. The human confirmed the reviewed scenarios above. Temporary capture fault injection was removed before handoff and is not part of the committed implementation. No production data or deployment was involved.

This establishes human acceptance of partial saved content. It does not establish live question-detail recovery, a genuinely successful pair of live detail and answer endpoints, or end-to-end execution through `add_url` and a deployed Cloudflare Workflow.

PR #614 was opened before this acceptance. The required pre-PR gate was missed; this later acceptance does not retroactively satisfy that ordering requirement. The human has now accepted the scenarios and requested that the existing PR be updated.

## Acceptance and release state

- Task 4.3 is complete: the requesting human accepted the reviewed Reader scenarios on 2026-11-16, with no adjustments requested.
- The historical pre-PR acceptance sequencing deviation remains explicitly recorded above.
- Production availability and actual live TikHub detail recovery remain unverified.
- This follow-up changes only acceptance documentation and task status; it is exempt from repeating application runtime verification and from client version increments. Existing implementation checks remain the evidence for the unchanged code.
- Nothing has been deployed or archived.
