# Validation

## Scope and approval

The user reviewed the two pipeline check inventories in conversation on 2026-11-09 and explicitly requested removal of unnecessary checks except emptiness. Implemented after merged PR #537, from origin/dev e1fa706f. No compatibility branches or feature flags.

This changes API generation behavior only. No client implementation, API response contract, dependency, package output or UI presentation changed; CLI, Extension and Mobile version increments are not applicable. Browser presentation acceptance is not applicable to this backend-only change.

## Automated checks

- `SLAX_API_SKIP_DOTENV=1 pnpm api -- test`: **3,781 passed, 118 skipped**, 241 files passed and 15 skipped (final complete run, 51.90 seconds). The removed tests asserted obsolete scoring rules; acceptance, empty output and execution-failure regressions replace them.
- Focused runner/capture/editing regressions after signature cleanup: **185 passed**.
- `SLAX_API_SKIP_DOTENV=1 pnpm api -- typecheck`: passed, including contracts typecheck.
- `SLAX_API_SKIP_DOTENV=1 pnpm api -- lint`: passed with 0 errors and 344 existing warnings.
- `pnpm exec openspec validate --all --strict`: **117 passed, 0 failed**.
- `SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example HYPERDRIVE_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/slax LOGS_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/logs pnpm api -- gen:all`: passed. Placeholder local URLs were used only for client generation; no operator secret files were loaded. No generated diff.
- `git diff --check`: passed.

Initial checks exposed obsolete expectations for title/language scoring and removed helper signatures. Those expectations were replaced by the newly approved acceptance contract, and the final complete suite passed.

## Running environment exercise

Command:

```sh
DOCKER_HOST=unix:///Users/daguang/.orbstack/run/docker.sock \
SLAX_API_SKIP_DOTENV=1 \
pnpm --dir apps/api exec tsx --tsconfig tsconfig.json test/runtime/mediaQualitySmoke.ts
```

The harness provisions a disposable PostgreSQL 17 database, applies the real migration history, uses production repositories and both generation runners, and sends the production DeepSeek client's HTTP requests to a local controlled server. Each scenario creates independent article/episode rows; the owned container is cleaned up afterwards. Runtime results are written as `media-quality-results.json` under the printed isolated artifact directory.

Nonempty output deliberately changes numbers, wording and language, is much shorter than the source, and repeats the same paragraph. Podcast source speech is sparse over 11,940 seconds. YouTube source metadata has a visual title and a non-auto language. Both pipelines deliver that text unchanged. Podcast original plus translation uses two model requests; YouTube body plus introduction uses two. There are no content-quality retries. Persisted article rows and body text are inspected, rather than trusting Workflow completion alone.

| Pipeline | Scenario | Outcome | HTTP model calls | Publication calls |
| --- | --- | --- | ---: | ---: |
| podcast | nonempty | ready | 2 | 1 |
| youtube | nonempty | ready | 2 | 1 |
| podcast | empty | retry | 1 | 0 |
| youtube | empty | failed | 6 | 0 |
| podcast | malformed | retry | 1 | 0 |
| youtube | malformed | failed | 6 | 0 |
| podcast | http | retry | 1 | 0 |
| youtube | http | retry | 1 | 0 |
| podcast | truncated | retry | 6 | 0 |
| youtube | truncated | failed | 16 | 0 |
| podcast | missing-write | retry | 1 | 0 |
| youtube | missing-write | retry | 2 | 0 |

For each fault case, the harness verifies no row is ready and publication is never called. Additional unit/runner tests exercise recovery after provider outage, accepted-checkpoint reuse, empty-only retries, source timing, unknown references, storage failures, CAS/lease ownership, moderation and Labs/access controls. Capture-flow tests confirm visual titles now admit nonempty captions while empty captions remain skipped.

## Limits of this evidence

The model HTTP responses and ASR results are controlled fixtures, not paid DeepSeek/AssemblyAI calls. R2 and publication/index callbacks are in-memory or counters; PostgreSQL and HTTP transport are real. The step adapter runs callbacks without Cloudflare Workflow persistence, scheduling delays or step retries. Real Workflow scheduling, external model quality, remote R2/Hyperdrive and the specific saved Pocket Casts article after deployment have not been verified in this change. No remote task was retried, no remote database was written, and nothing was deployed. The saved podcast's production failure was `chunk_quality:number_coverage`; that rejection path is deleted, but these checks do not promise universal provider availability or semantic correctness.

## Local pre-push review

- **Bugs:** No Important findings. Checked nonempty output acceptance without repeated model calls, preserved source-owned YouTube IDs and best-effort cue timing, retained malformed/empty/truncated response recovery, CAS leases, cost accounting and read-after-write publication. Historical failed/skipped rows are not mass-requeued; existing owner retry remains available.
- **Security:** No Important findings. Moderation, authorization, takedown, HTML escaping and secret handling are unchanged. New telemetry contains counts only. Runtime tests bind HTTP/PostgreSQL to loopback and only clean up their own disposable resources.
- **Compliance:** No Important findings. Change `remove-media-quality-gates` matches the conversation-approved removal and its delta specs. The earlier cap change is merged, so this is sequenced rather than a parallel capability implementation. Runtime limitations are declared above. No package version decision is needed for this API-only implementation with unchanged client contracts.
