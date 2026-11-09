# Validation

## Scope and approval

On 2026-11-09 the owner confirmed removal of business caps from both podcast and YouTube article generation. Request deadlines, finite retries/repair, concurrency, leases, moderation, access control, and validation remain. This is API-only, with no client package, schema, environment variable, or UI presentation changes. Merge and deployment are human-operated.

## Automated verification

- `SLAX_API_SKIP_DOTENV=1 HYPERDRIVE_DATABASE_URL=postgresql://local:local@127.0.0.1:5432/local LOGS_DATABASE_URL=postgresql://local:local@127.0.0.1:5432/logs SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- gen:all`: passed. Only removal of the obsolete YouTube budget-alert DI argument is generated into the diff.
- `pnpm api -- test`: 3,826 passed, 118 skipped in the full backend suite. Includes deadline, bounded retry, accounting failure, lost lease, moderation, ownership, translation recovery, and actual Workerd provider-client regressions.
- Targeted final runner/service/planner/editor/Workerd checks: 339 passed before the additional four-hour eligibility-gate removal; the full suite subsequently passed again after that removal (3,826 passed, 118 skipped).
- `pnpm api -- typecheck`: passed.
- `pnpm api -- lint`: passed with existing warnings and no errors.
- `pnpm exec openspec validate --all --strict`: 115 items passed.
- `git diff --check`: passed.

## Running environment exercise

Command (Docker socket path depends on the local Docker installation):

```sh
DOCKER_HOST=unix:///Users/daguang/.orbstack/run/docker.sock SLAX_API_SKIP_DOTENV=1 pnpm --dir apps/api exec tsx --tsconfig tsconfig.json test/runtime/mediaCapsSmoke.ts
```

The harness creates and removes its own PostgreSQL 17 container, applies all 57 historical migrations, and uses the production repository classes and workflow runners. It sends production DeepSeekClient protocol requests over HTTP to a controlled local provider. ASR responses, workflow step scheduling, object storage, moderation, and bookmark publication/indexing dependencies are controlled substitutes. No secret file or remote database is read, and no paid provider is called.

Before the runner exercises, 26 repository integration tests pass on the disposable PostgreSQL database. They cover requeueing failed/skipped cap rejections, retained run/lifetime costs and ASR job IDs, remaining terminal transcript errors, attempts, claims, leases, and row isolation.

| Exercise | Input / former caps exceeded | Observed outcome |
| --- | --- | --- |
| Podcast | 11,940 seconds (3h19m), 332 chunks, $10 prior episode spend, $2 controlled ASR charge | Transcript and article ready; 332 model calls; episode cost $12, article cost $1.2948; every normalized source cue and its complete text preserved; one ASR submission and one publication callback |
| YouTube | 29,990,970 ms (about 8h20m), 1,538,890 characters, 143 chunks, $10 prior run cost / $20 prior lifetime cost | Actual eligibility evaluator returns generate despite the former four-hour gate; article ready; 144 model calls; run cost $10.5616 and lifetime cost $20.5616; all 2,000 source cue references preserved |

Observed simultaneous HTTP provider calls were 3 in each final exercise, below the unchanged bounds of 10 podcast chunks and 5 YouTube chunks. Focused controlled-delay runner tests separately assert those concurrency bounds under load. Total estimated usage charged in this fixture run was $3.8564; these are synthetic usage values, not actual charges. Wall times are deliberately not presented as real model latency.

The first smoke attempt exposed a harness assertion mistake: ASR segments are normalized/grouped into transcript cues, so article IDs must be compared against normalized transcript cues, not the raw ASR segment count. The assertion now checks both normalized cue coverage and exact complete transcript text; the final run passes. The first environment attempt needed the local Docker socket explicitly passed because LocalResources intentionally isolates the process environment.

## Pre-push review

Reviewed under REVIEW.md: Bugs, Security, Compliance; change ID `remove-media-generation-caps`.

- Bugs: traced capture eligibility, plan preparation, pre/post-ASR duration checks, per-call accounting, service open/crawl/retry/sweep paths, and database retry predicates. Found and removed the separate four-hour automatic eligibility gate during review, then extended its test and runtime exercise. No remaining Important findings.
- Security: ownership, sharing, moderation, bounded requests, retries, and concurrency remain enforced. More spend is an explicit approved behavior change. The harness is local-only and exclusively owns its disposable container. No credentials or new network destinations are introduced in production code. No Important findings.
- Compliance: implementation matches the confirmed scope, retains accounting, removes cap logic rather than adding switches or larger ceilings, and does not bulk-requeue history. The change follows already merged media changes; their unarchived artifacts are not edited in parallel. No Important findings.

## Limits of evidence

The original production audio was not retranscribed and live DeepSeek language quality/latency was not benchmarked. The local exercise does not reproduce Cloudflare Workflow scheduling, production R2, Redis, Hyperdrive caching, or bookmark publication end to end. Daily start/spend behavior is covered by service tests; actual repository transitions are covered on local PostgreSQL. No deployment or production retry was performed. External provider/platform resource limits still apply, so this change removes application business rejections rather than guaranteeing success for arbitrarily large inputs.

## PR review follow-up

PR #537 targets dev. All CI gates passed for implementation commit `7e345397`. Automated Bugs/Security/Compliance review reported **No Important findings** and two Nits. Both are addressed in the follow-up: the podcast article requeue fake accepts skipped rows and two owner/visitor recovery regressions cover preserved costs; the living reliability Purpose and the eligibility delta no longer describe removed length limits. The follow-up changes only tests and specification/evidence documents; production code is unchanged. The focused podcast service suite and strict spec validation are rerun for this follow-up. Merge, deployment, and post-merge archival remain human-operated.
