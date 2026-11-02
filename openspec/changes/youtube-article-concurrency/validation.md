# Validation

Date: 2026-11-02. Branch: `fix/youtube-article-concurrency`, based on `origin/dev`.

## Approval and scope

Luca approved five concurrent chunks and continued implementation on 2026-11-02.
This is an API execution change. No client code, response shape, UI control, or package output changes.
Web/API changes do not require package increments under docs/release/VERSIONING.md.
No UI presentation acceptance applies. Real-model wording remains a verification gap below.

## Regression evidence

Before implementation, the new concurrency test failed: expected five active calls, received one.
The original 42 runner tests passed in that run.

After implementation:

- Runner: 52 tests passed. Tests cover five active chunks, translated output order, budget waiting, accounting errors, sibling settlement, cancellation, ownership loss, and partial replay.
- Runner and Vertex client: 71 tests passed. The client test verifies cancellation forwarding and unchanged configuration for callers without a signal.
- API suite: `pnpm exec vitest run --config vitest.config.ts --maxWorkers=2` reported 199 files passed, 14 skipped; 2,728 tests passed, 113 skipped.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm api -- build`: passed with the public template; all Worker dry runs completed.
- Changed-source ESLint: zero errors; 15 existing explicit-any warnings in the Vertex client and workflow wrapper.
- `pnpm api -- gen:all`: passed with the public template, secret loading disabled, and placeholder database URLs. Generated tracked outputs did not change.
- `pnpm exec openspec validate --all --strict`: 95 passed, zero failed.
- `git diff --check`: passed.

The first sandboxed full-suite run could not start localhost fixtures.
An unrestricted run exposed an unchanged port-guard fixture failure: its relocated Node binary could not resolve `libnode.127.dylib`.
A direct subprocess reproduced the loader failure. The complete two-worker run subsequently passed.
The further full run supplied the installed Node library directory explicitly and passed: 199 files, 2,728 tests, 113 skipped.

## Running environment

Command: `pnpm exec tsx --tsconfig tsconfig.json test/runtime/20261102-youtube-concurrency.ts` from apps/api.

The runner called a real localhost HTTP server with controlled 80 ms model responses.
Its dependencies used an in-memory row and object store. This does not exercise Cloudflare durable persistence or Gemini.

| Mode | Elapsed | Peak model calls | Ordered cues | Recorded cost |
| --- | ---: | ---: | ---: | ---: |
| Serialized steps | 820 ms | 1 | 650 | $0.0945 |
| Five concurrent chunks | 199 ms | 5 | 650 | $0.0945 |

Both runs published a complete article. The harness asserted exact cue order, equal coverage, and the concurrency ceiling.
These timings prove scheduling overlap in this fixture. They do not predict production latency.

## Verification gaps

- Real Gemini latency and translation quality: this process has no VERTEX_API_KEY. No secret files were read.
- Deployed dev workflow: the available Cloudflare account did not expose the dev workflow during the preceding investigation.
- Cloudflare durable replay and provider-side cancellation: simulated replay and cancellation passed locally; deployed engine behavior remains unverified.
- Database integration suites: 113 tests require their separately configured integration services and were skipped by the suite.
- The original saved article was not regenerated. This task changes code and opens a PR; it does not deploy or alter remote article records.

## Review

An independent agent reviewed the design and implementation under REVIEW.md.
It reported no Important Bugs or Security findings and independently passed the initial 49-test runner suite.
Its additional test requests were implemented: partial replay, cancellation, and concurrent ownership loss.
The final independent review found no Important Bugs, Security, or Compliance findings.
The reviewer independently passed the final 71-test focused run and git diff --check.
PR review gate results remain pending until the pull request exists.
