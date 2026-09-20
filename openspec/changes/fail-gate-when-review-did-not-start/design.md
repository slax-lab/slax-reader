# Design — failing the gate when a review never started

## Context

Motivation and scope live in `proposal.md`; the behavior contract is in `specs/agentic-pr-review/spec.md`. What shapes the approach:

- **The gate is a plain Actions workflow that reads another run's job list.** `pr-review-gate.yml` reacts to `workflow_run: [completed]`, fetches `actions/runs/<id>/jobs`, and posts one commit status under the context `PR review gate`. Its only inputs are therefore *job conclusions* (and, if it asks, *step conclusions*) — it cannot read a job's `outputs`, and it does not run inside the review.
- **The gate's own history is a list of bypasses found by reviewers**, each fixed by narrowing when it is allowed to report or what it accepts as evidence: 7.1/7.2 (a skipped job passes as a required check — why the gate exists at all), 7.11/7.14 (report against the reviewed commit, not the current head), 7.13 (a run that was not supposed to review must not clear a failing verdict), 7.15 and 8.6 (green, and red, both require that a review was actually published). This change is the same kind of fix: the gate accepts `agent: skipped` as evidence without asking *why* the agent was skipped.
- **Where each outcome is compiled** (line numbers from the pinned `v0.88.7` output):
  - `pre_activation` carries the pause switch, the fork check, and the draft and stack checks — `.github/workflows/pr-review.lock.yml:1730`, `.github/workflows/pr-review-command.lock.yml:1752`.
  - `activation` requires `needs.pre_activation.outputs.activated == 'true'` plus a repeat of those guards — `pr-review.lock.yml:87`, `pr-review-command.lock.yml:89` — and owns the stale-lock check (`Check workflow lock file`).
  - `agent` is gated only by the budget guardrail: `if: needs.activation.outputs.daily_ai_credits_exceeded != 'true'` — `pr-review.lock.yml:394`, `pr-review-command.lock.yml:416`.
  - `conclusion` uses `always() && (needs.agent.result != 'skipped' || … stale_lock_file_failed … || daily_ai_credits_exceeded == 'true')` — `pr-review.lock.yml:1187-1190`.
- **What the run population actually looks like.** Across the last 200 runs of both workflows, the 91 non-success runs are 69 whose every job is `skipped` (the legitimate skips in D2), 19 real reviews that failed on findings, one detection block, and **exactly one `activation: failure`** — the E009 incident. The membership/`activated` tuple has never occurred. The gate has zero references to `pre_activation` or `activation` today.

## Goals / Non-Goals

**Goals:**

- A required check that cannot report success for a review run that never started.
- No false blocking of the skips that are supposed to pass: a pause, a fork pull request, a stacked pull request, a draft, a budget cap.
- A failure description that sends the reader to the real cause instead of naming three causes and meaning none.
- Keep the change small enough that the check's name, its reporter, and the ruleset stay as they are.

**Non-Goals:**

- Re-running, repairing, or annotating reviews; the gate only reports.
- Distinguishing *which* decline happened when the conclusions cannot distinguish it (pause, fork, draft, stack, and a request gh-aw does not accept all produce one signature — see D2; a passing skip is a passing skip).
- Changing which `/review` comment bodies the command trigger accepts (see Open Questions; the human reviewing this proposal decided to keep that behavior).

## Decisions

### D1. Decide from the pre-agent stage conclusions, with a whitelist

The gate gains two more conclusions from the same jobs call it already makes — `pre_activation` and `activation` — and replaces the single `case "$agent"` with:

| `pre_activation` | `activation` | decision |
|---|---|---|
| anything but `success`/`skipped` | (any) | **fail closed** |
| `success` or `skipped` | `skipped` | **passing skip** — the review system declined to activate the run |
| `success` | `success` | the run started → the existing `agent`/`review_verdict` logic, unchanged |
| `success` or `skipped` | anything else | **fail closed** |

The rule is deliberately a **whitelist of passing shapes**, not a blacklist of known-bad ones. A blacklist (`activation == failure` → fail) would fix today's incident and leave the next one: every conclusion the gate does not recognize would keep falling through to the existing `agent: skipped → success` branch. The whitelist makes "unrecognized" fail closed by construction, so a conclusion added by a future gh-aw release, a stage that did not run at all, or a run cancelled before activation reports failure rather than passing as a skip.

The principle behind the two passing shapes is that they are **decisions, not errors**: a false `activation` condition means the system decided not to activate the run, while a stage that *errored* fails its job. That is why `activation: skipped` passes even when `pre_activation` succeeded — that tuple is gh-aw's own `activated != 'true'` decision (the membership path), and it has never occurred in this repository's history (D2 records it as the one tuple with no runtime evidence).

### D2. The signature table, and what each row rests on

| outcome | `pre_activation` | `activation` | `agent` | gate | evidence |
|---|---|---|---|---|---|
| normal review | success | success | success | existing logic | every review run |
| reviews paused (`PR_REVIEW_ENABLED=false`) | skipped | skipped | skipped | pass (skip) | pause drills: runs 35409308207 (#23), 35428879403 (#40); compiled `if:` (Context) |
| fork pull request (**automatic workflow only**) | skipped | skipped | skipped | pass (skip) | fork drill: run 35429105440 (#41); archive task 4.2 |
| draft pull request | skipped | skipped | skipped | pass (skip) | draft drill: run 35431104953 (#48); observed again on this change's own draft PR #69 — run 35501003126, which drew the three-way skip description with no pause variable, no fork and no budget cap (D5) |
| stacked pull request (not top of stack) | skipped | skipped | skipped | pass (skip) | compiled `if:` (Context) |
| `/review` request gh-aw declines (trailing CRLF, or an actor without write access) | skipped | skipped | skipped | pass (skip) — **unchanged by this change**, see Open Questions | PR #66: comment at 06:47:48 vs run 35495160078 |
| framework declines activation (`activated != 'true'`, membership path) | success | **skipped** | skipped | pass (skip) | **never observed** — read off the compiled conditions; the only passing tuple without runtime evidence |
| budget cap, daily guardrail (inert) | success | success | skipped | pass (skip) | compiled `if:` (Context); the guardrail computes `aic: 0` for this model (archive task 2.6), so it has never fired and is not expected to |
| budget cap, per-run `max-ai-credits` (the one that works) | success | success | **failure** | fail | it fails the *agent*, never activation — existing logic |
| **compiled lock out of date (E009)** | **success** | **failure** | skipped | **fail** | review side: run 35490678495; gate side: run 35490745228 posted `success — Review skipped (…)` at 05:04:36Z |
| threat detection blocks | success | success | success | fail | drill #59, archive task 8.6 |
| agent fails, or succeeds without a verdict | success | success | failure / success | fail | existing logic |
| run cancelled before activation | cancelled | skipped | skipped | **fail** (new) | derived from the whitelist; today this reports a passing skip |
| a `pre_activation` step throws | failure | skipped | skipped | **fail** (new) | derived; never observed |

Rows worth calling out. The **budget cap** row shows why the skip description has to be split: an activated run whose agent was skipped is provably *not* paused, a fork, or a draft, because those conditions sit on `pre_activation`. The **E009** row is the bug, and it is the only `activation: failure` in the repository's history — the gate's own log for it reads `agent=skipped verdict=skipped -> success (Review skipped (paused, fork pull request, or budget cap))` with `reviewed=` empty, because the "no review published" fail-closed branch only runs when `agent=success`.

### D3. Fail closed for anything unrecognized, and say what stopped

The failure description names the first stage whose conclusion is neither the passing shape nor `success`, e.g. `Review did not start (activation: failure); failing closed`. When the jobs API shows exactly one failed step inside that stage, the step name replaces the conclusion — `Review did not start (activation failed at 'Check workflow lock file')` — because that is the string that tells a reader what to do and it is what the incident's activation job carried. The lookup is best-effort: with zero or several failed steps the description falls back to naming the stage, so an unexpected step layout degrades the message rather than the verdict.

Chosen over the three obvious alternatives:

- **Rejected: reading `activation`'s outputs** (`stale_lock_file_failed`, `daily_ai_credits_exceeded`). They are exactly the signals that would separate the stale-lock failure from the budget skip — and the REST jobs API does not expose a job's outputs, only its and its steps' conclusions. The gate cannot read them without changing how it observes the run.
- **Rejected: matching gh-aw's error strings or step names as the decision rule.** Step names are gh-aw internals that move between releases; using one to *decide* would turn an upstream rename into a silently wrong verdict. Using it to *describe* a verdict already reached is the safe half of that coupling.
- **Rejected: the activation check-run annotation as the description.** It carries the exact reason verbatim — the E009 annotation reads `ERR_CONFIG: E009 CONFIG_HASH_MISMATCH: Lock file '…' is outdated! … Run 'gh aw compile' to regenerate the lock file.` — but it is an unbounded upstream string that would have to be truncated into a 140-character status, and reading it costs another API call per failure. The status already links to the run through `target_url`, which is where the annotation lives; the step name is the cheap summary.

The residual risk is stated in the proposal: if a future release sets `stale_lock_file_failed` without failing `activation` (activation success, agent skipped), that shape is indistinguishable from the budget cap from job conclusions alone, and the gate would pass it. This is the specific reason `tasks.md` ties a re-read of the decision rule to the next gh-aw pin bump rather than leaving it to memory.

### D4. The check's identity does not change

The status context stays `PR review gate`, reported by the same workflow, so the `protect` ruleset needs no edit and no window exists in which the required check is unreported. What changes is semantics only: *success* now means "declined, or actually reviewed", where it previously also meant "stopped before the agent for a reason the gate could not see".

Consequence for ordering, which the original rollout already met (archive tasks 4.1, 5.1, 7.10): `workflow_run` only triggers workflows that live on the default branch, so **the new logic cannot act until it is merged**. Verification is therefore split — replay real historical runs against the new classification offline (the decision is a pure function of the jobs list, so a replayed run is real evidence, not a simulation), then one live drill after merge on a throwaway pull request whose branch carries a deliberately stale lock (its own review run fails activation before the agent, at zero model cost, exactly as `main` did).

### D5. The skip description names only causes the gate can verify

The old string — `Review skipped (paused, fork pull request, or budget cap)` — was a three-way guess that can be false in all three parts at once, and during the incident it was. Live proof of how ordinary that is, on this change's own draft pull request: run 35501003126 was declined because the pull request was a draft, and the gate reported `success — Review skipped (paused, fork pull request, or budget cap)` — no pause variable existed, the pull request is not a fork, and no budget cap was involved.

Replacing one guess with a shorter guess would repeat the mistake. The replacement names a cause only where the gate can check it:

| outcome | description |
|---|---|
| declined, reviews paused | `Review not run (reviews are paused)` — the pause is readable in the gate's own expressions as `vars.PR_REVIEW_ENABLED == 'false'`, the same evaluation GitHub performs for the review workflow's `if:` |
| declined, otherwise | `Review not run (not activated for this run)` — fork, draft, stacked, and a declined request are indistinguishable from job conclusions, so none of them is named |
| activated, agent skipped | `Review not run (budget cap)` — the only condition gating `agent` |
| failed before the agent | `Review did not start (<stage>: <conclusion>); failing closed`, with the single failed step's name in place of the conclusion when the jobs response carries exactly one |

Reading the pause from `vars` costs no API call and is the one skip cause worth stating, because it is deliberate and an operator set it. Reading the pull request's draft or fork state to name those too was considered and rejected: both are already visible on the pull request itself, and every extra inference is another claim that can be wrong — which is the failure this decision exists to remove.

The rule the incident violated, stated once so it can be checked: **no description names a cause the gate has not verified**. It is the one thing `REVIEW.md`'s scope rule keeps out of the review-policy file — the gate's commentary lives in the workflow, which is where this change updates it.

## Risks / Trade-offs

- **A future gh-aw release changes the pre-agent shapes** → the whitelist fails closed (loud, recoverable: `/review` re-runs, admin bypass) except in the one shape named in D3, which is why the gh-aw pin bump carries a task to re-read the decision rule.
- **Stricter semantics block a merge that used to pass** → that is the intent, and every skip that exists in practice (pause, fork, draft, stack) keeps passing; the ruleset's repository-role bypass remains the emergency exit and is unchanged.
- **The description could still mislead** if a stage fails for several reasons at once; it names one stage and at most one step, which is a claim the API supports — no cause is inferred from prose.
- **Duplicating skip semantics** between the gate and the workflow frontmatter (the pause lives in `pre_activation`'s condition) couples the gate's reading to where gh-aw compiles that condition. Mitigated by verifying on every gh-aw bump, and by the fail-closed default: a moved condition produces a *failure*, not a silent pass.

## Open Questions

- **Is a live pause drill needed after this change?** The pause signature is identical to the fork, draft, and stack signatures and all land in the passing-skip row, so replaying a recorded paused run (run 35409308207 or 35428879403) exercises that branch with real data. Whether to re-run the drill procedure anyway (archive task 5.4) is a judgement call the reviewer can make; `tasks.md` records the cheaper reading and why.
- **Decided, recorded here so it is not rediscovered: a `/review` request gh-aw declines is left alone.** A body of `/review` plus CRLF — legal in a comment — matches none of the three forms gh-aw v0.88.7 compiles (`pkg/workflow/command.go` builds `startsWith(body, '/review ')`, `startsWith(body, '/review\n')` and `body == '/review'`, with no trimming and no frontmatter knob), so the run skips at `pre_activation` and the trigger never fires. The human reviewing this proposal decided to keep that behavior rather than widen the accepted forms or add a gate signal for it, so it is a known limitation rather than a task. The durable fix is upstream in gh-aw; a workaround was rejected because the gate's verdict here is faithful — the run really was declined — and because the two alternatives are worse than the limitation: widening the forms means replacing the `slash_command` trigger (the re-architecture archive task D3 already rejected once), and reporting `failure` would let any passer-by block a pull request on a public repository by commenting `/review`.
