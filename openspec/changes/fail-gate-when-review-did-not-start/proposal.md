# Fail the merge gate when a review never started

## Why

`pr-review-gate.yml` is the only required check for the review system, and it decides by reading two jobs of the run it observes: `agent` and `review_verdict`. A gh-aw run whose **`activation` job fails** reports `agent: skipped`, and the gate reads `skipped` as one of the legitimate skips it was written to wave through — so the required check goes **green for a review that never ran**.

That is not hypothetical. From commit `64edab3` until #66 recompiled the locks, `main`'s `/review` path died at activation:

```
ERR_CONFIG: E009 CONFIG_HASH_MISMATCH: Lock file '.github/workflows/pr-review-command.lock.yml' is outdated!
```

Run [35490678495](https://github.com/slax-lab/slax-reader/actions/runs/35490678495) is that failure in the job list: `pre_activation` **success**, `activation` **failure**, `agent`/`detection`/`review_verdict`/`safe_outputs` **skipped**, the run's own conclusion `failure`. The gate reported

```
success — Review skipped (paused, fork pull request, or budget cap)
```

on the reviewed commit. The gate's own log for the run that observed it ([35490745228](https://github.com/slax-lab/slax-reader/actions/runs/35490745228)) prints `agent=skipped verdict=skipped -> success (Review skipped (paused, fork pull request, or budget cap))` with `reviewed=` empty: the "no review published" fail-closed branch is only reachable when `agent=success`, so a run that published nothing never reaches it. So the pull request record said "reviewed and clean" about a review that produced nothing, and the check whose entire purpose is to catch that reported nothing wrong. The repository variables were also empty at the time, so the "paused" the description blamed did not even exist as a setting.

The gate could not tell the difference for two reasons, and this change fixes both: it never looks at the stages **before** the agent, and its skip description is a hard-coded three-way guess — "paused, fork pull request, or budget cap" — that names three causes and never the real one.

## What Changes

- The gate reads `pre_activation` and `activation` alongside `agent` and `review_verdict`, and grants a passing result only on a **positive** signal:
  - `activation: skipped`, with `pre_activation` `success` or `skipped` — the run was *declined* rather than stopped. Reviews paused, a fork pull request, a draft, a stacked pull request, and a request gh-aw does not accept all compile to this shape → the passing skip it reports today;
  - `pre_activation: success` **and** `activation: success` — the run started → the existing agent/verdict logic, unchanged;
  - anything else — including the `activation: failure` above — **fails closed**.
- The rule is a whitelist rather than a blacklist of known-bad conclusions, so a shape the gate has never seen fails closed instead of passing as an unrecognized skip: a run cancelled before activation, a stage that threw, or a conclusion a future gh-aw release introduces.
- The failure description names the stage that stopped the run, and the step inside it when exactly one step failed — or the stages' outcomes when no single stage stopped it, so it can never name a stage that succeeded — instead of reciting a guess about the cause.
- The skip description stops guessing causes. It names the pause only when the gate can verify it (reading `vars.PR_REVIEW_ENABLED` in its own expressions), reports a run whose agent did not start as exactly that and no more, and otherwise says only that no review was produced — instead of today's three-way string, which on this change's own draft pull request (#69, run 35501003126) claimed a pause, a fork, or a budget cap when none of the three applied.
- No new status context, no new job, and **no ruleset change**: the check keeps the name `PR review gate`. Only its semantics get stricter.
- The gate's header comment — the only place this repository documents the gate, since `REVIEW.md` carries review instructions and nothing else — is brought in line.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agentic-pr-review`: the merge-gate requirement gains the rule that a passing result requires the review run to have been either deliberately not started or actually executed, plus the scenarios that pin the failing and the unclassifiable signatures. Its existing scenarios (Important findings block; an unpublished run is described as unpublished; failure is reported, not silent) are carried over unchanged.

## Impact

- **Files**: `.github/workflows/pr-review-gate.yml` (classification, descriptions, and its documentation comment) and this change's delta spec.
- **Verification is post-merge by construction**: `workflow_run` only triggers workflows that exist on the default branch, so the new branch cannot act until this change is on `main` — the constraint the original rollout hit too (archive tasks 5.1 and 7.10). The execution plan therefore leans on replaying real historical runs against the new logic offline, then one live drill on a throwaway pull request after merge; `tasks.md` carries both.
- **Behavior changes in the strict direction only.** A pull request can no longer merge on a review that never started. A paused repository, a fork pull request, and a stacked pull request keep the passing skip they have today, so the requirements that a skip must never block a merge are untouched.
- **Residual risk, accepted**: a future gh-aw release could make a genuine configuration failure stop in a shape the whitelist does not anticipate, or could stop failing `activation` for a stale lock and instead skip the agent after a successful activation. The first direction fails closed (loud, `/review` re-runs, the ruleset's admin bypass exists); the second is the one shape this change cannot distinguish from the budget cap, and it is recorded in `design.md` as the reason the decision rule is reviewed when the gh-aw pin moves.

## Non-Goals

- **Not** changing the check's name, which job reports it, or the `protect` ruleset.
- **Not** making the gate re-run or repair a review; it only reports what happened.
- **Not** changing which `/review` comment bodies the command trigger accepts. A body of `/review` plus CRLF matches none of the three forms gh-aw v0.88.7 compiles, so that request skips at `pre_activation` and the review simply does not run — observed on PR #66, where a member's `/review\r\n` at 06:47:48 was declined (run [35495160078](https://github.com/slax-lab/slax-reader/actions/runs/35495160078)) and a plain `/review` five minutes later reviewed normally (run [35495375114](https://github.com/slax-lab/slax-reader/actions/runs/35495375114)). The gate's passing skip is a faithful report of what the run did; the defect is upstream in gh-aw's matcher (`pkg/workflow/command.go`: no trimming, no frontmatter knob), and the human reviewing this proposal decided to leave the behavior as it is rather than widen the accepted forms or add a gate signal. `design.md` records the decision, the evidence, and why the two workarounds are worse than the limitation.

## Open Questions

- **Is a live pause drill needed after this change?** Every recorded skip — pause (runs 35409308207, 35428879403), fork (35429105440), draft (35431104953) — collapses to one signature, so replaying the recorded paused runs already exercises the passing-skip branch with real data. Whether to re-run the pause drill procedure the archive used (task 5.4) is a judgement call for the reviewer; `tasks.md` records the cheaper reading and why.
- **The one shape with no runtime evidence**: `activation: skipped` while `pre_activation` succeeded (gh-aw's own `activated != 'true'` membership decision). It is treated as a decline because a false activation condition is a decision while an error fails the job, and it has never occurred in 200 runs of history — but a reviewer who wants it to fail closed instead should say so before implementation.
