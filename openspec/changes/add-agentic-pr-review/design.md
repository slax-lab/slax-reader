# Design — agentic PR review on our own DeepSeek key

## Context

Motivation and scope live in `proposal.md`; the behavior contract is in `specs/agentic-pr-review/spec.md`. What shapes the approach:

- **gh-aw is a compiler, not a service.** A workflow is a Markdown file with YAML frontmatter; `gh aw compile` turns it into a normal GitHub Actions workflow (`.lock.yml`) that must be committed alongside the source. The documented claim that body-only edits need no recompilation does not hold in practice: the compiled metadata carries a `body_hash`, so editing the prompt body changes the lock file — which our compile-drift guard would flag (observed while building the guard, task 3.1). Treat every edit to a workflow source as requiring a recompile.
- **The compiled workflow runs the agent sandboxed and read-only.** AWF puts the engine in a container behind a Squid egress allowlist; the Copilot engine is launched by gh-aw's built-in Node harness; model traffic goes through a trusted API proxy that holds the BYOK credential; all writes are deferred to `safe-outputs` jobs after a threat-detection verdict.
- **Repository constraints.** The org is on the GitHub **Free** plan (organization rulesets unavailable), the repository is **public** (Actions minutes are free), and the `protect` ruleset already requires the `guard` status check plus one approving review, CODEOWNERS review, thread resolution, and last-push approval. `REVIEW.md` is the single source of truth for review policy; behavior-changing PRs must carry `OpenSpec: <change-id>`.
- **Provider facts** (DeepSeek API docs, 2026-09-10): model id `deepseek-flash` (DeepSeek-V4.1-Flash), OpenAI-format base URL `https://api.deepseek.com`, tool calls and streaming supported, 1M context / 384K max output, peak/off-peak pricing (peak = 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri; off-peak is half price).

## Goals / Non-Goals

**Goals:**

- A review that is faithful to `REVIEW.md` and to the linked OpenSpec change, published through native GitHub review surfaces.
- The review runs on our DeepSeek key with the credential never entering the agent's environment.
- A merge gate that fails on Important findings and **cannot** wedge a pull request by never reporting.
- Reproducible builds: pinned tool/engine versions and a CI check that the compiled workflow matches its source.

**Non-Goals:**

- Replacing human review. The ruleset keeps one required human approval and CODEOWNERS review; this change only adds an automated check.
- Reviewing fork pull requests, reviewing on every push, auto-applying fixes, or auto-approving.
- Multi-provider routing or fallback to a GitHub-hosted model when DeepSeek is unavailable (we fail closed instead).
- Organization-wide rollout or a reusable workflow for other repositories.

## Decisions

### D1. Review engine: gh-aw with the Copilot engine in BYOK mode

Chosen because it is the only option that (a) exists for us today — GitHub-hosted Copilot code review cannot be enabled on a Free-plan org with 0 Copilot Business seats, and that product does not support BYOK at all — and (b) executes on our own key while keeping the agent read-only and sandboxed.

Alternatives considered: **GitHub-hosted Copilot code review** (unavailable, model not selectable); **a hand-written review action or script** (we would rebuild sandboxing, safe-output validation, threat detection, and prompt plumbing ourselves); **the Claude/Codex engines** (would need a second provider key, which is not the goal).

### D2. Model and provider wiring

```yaml
engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: https://api.deepseek.com
    COPILOT_PROVIDER_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    COPILOT_MODEL: deepseek-flash
sandbox:
  agent:
    model-fallback: false
models:
  # The AWF API proxy must be able to price every model it accounts for; see below.
  default-ai-credits-pricing:
    input: 0.3
    output: 1.2
    cache_read: 0.006
network:
  allowed:
    - defaults
    - api.deepseek.com
```

- **`models.default-ai-credits-pricing` is required, not optional.** The AWF API proxy computes AI credits for every request in order to enforce `max-ai-credits`, and `deepseek-flash` is absent from its built-in pricing table. Without a fallback rate the proxy rejects the request before it ever reaches DeepSeek: `400 Model "deepseek-flash" has no AI credits pricing and no default pricing is configured` (observed in spike run 35329370946, with **0** tokens consumed). This was the blocking failure the spike existed to find, and it is not the failure `model-fallback` addresses.
- The values are DeepSeek V4.1-Flash **peak** rates in USD per 1M tokens (input 0.3, output 1.2, cache-read 0.006), so AIC over-estimates off-peak usage instead of under-estimating it; gh-aw maps `cache_read` to AWF's `cachedInput`.
- `model-fallback: false` keeps AWF from rewriting the model name through its built-in catalog — the documented requirement for BYOK deployments whose model ids the catalog does not know.
- `api.deepseek.com` must be listed explicitly because the provider URL travels through a secret-backed variable; gh-aw's automatic allowlist derivation only applies to literal URLs.
- `COPILOT_PROVIDER_TYPE` stays at its `openai` default (Chat Completions). DeepSeek also exposes an Anthropic-format endpoint, but the OpenAI path is the one verified end to end.
- Rejected: `deepseek-v4-pro` (higher price, and DeepSeek's own V4.1-Flash benchmark claims supersede it) and `sandbox.agent.token-steering: false` is **not** set initially — only changed if AWF interferes with the configured provider/model.

**Spike evidence (task 1.4, throwaway branch `spike/gh-aw-byok`).** With the wiring above all six jobs succeeded (run 35329927208): the agent ran shell commands (`git log`, read `README.md`, `git ls-files`), reported the correct newest commit subject, README heading and root-file count, and identified `deepseek-flash` as its model — so tool calling works through AWF against DeepSeek. That run consumed 82,370 tokens → **AIC 0.639 (≈$0.0064)** in 4.2 minutes, with firewall 25/25 requests allowed and 0 blocked. The earlier failing variant consumed 0 tokens, which confirms rejections happen at the proxy, not at the provider.

### D3. Triggers, and the slash-command complication

Automation: `pull_request: types: [opened, ready_for_review]`. Manual: `/review`.

gh-aw cannot combine an inline `slash_command` trigger with `pull_request` (the compiler rejects the conflict), so this workflow uses `on.slash_command.strategy: centralized`. Consequences to handle in implementation:

- The compiler emits an additional `agentic_commands.yml` dispatcher workflow that must be committed too — but **only a full `gh aw compile` (without a workflow argument) generates it**; compiling a single workflow leaves it absent, which the CI drift check (D9) must account for. The generated dispatcher listens on `issue_comment`/`pull_request` and routes `/review → pr-review` with `reaction=eyes`; verified in the compiled file.
- Centralized routing enables a built-in `/help` command by default; set `help_command: false` in `.github/workflows/aw.json` so the bot does not advertise commands we have not curated.
- The command path also defaults to `reaction: eyes` and `status-comment: true`. Keep the reaction as the acknowledgement, but set `status-comment: false`: a generic started/completed comment would fire on every `/review`, and the dispatcher is not gated by the pause switch (D10), so such a comment would also break the pause guarantee.
- `workflow_dispatch` only works when the workflow file exists on the default branch, so a workflow that lives only on a feature branch cannot be dispatched — verified while building the spike, which had to fall back to a branch-scoped `push` trigger. Consequence for this change: the `/review` path is triggered by dispatch from the centralized dispatcher, so it can only be verified end to end once the review workflow is on `main`; task 4.1 must account for that ordering.

Chosen instead of a single workflow: **splitting automatic and manual review into two workflows** (`pr-review.md` for `pull_request`, `pr-review-command.md` for the inline `slash_command`), sharing one `shared/pr-review-core.md` import. The single-workflow variant with the centralized dispatcher was implemented first and had to be abandoned: gh-aw also applies the command-position check to the **pull request body**, so the first real run skipped the entire automatic review (`None of the commands [/review] matched the first word (found: '##')`, PR #18). The split costs one wrapper per path while the policy, prompt, outputs and budgets stay in the shared import; `agentic_commands.yml` was purged.

### D4. Merge gate: a deterministic verdict, reported as a job-level status

Requirements demand both "fails on Important findings" and "never leaves a check unreported". A check run created by the agent fails the second property — if the agent crashes or the provider is unreachable, nothing is posted and a required check would stay pending forever, blocking every merge.

First attempt (rejected by evidence): make the required check the **job-level status** of a gh-aw custom safe-output job (`review-verdict`) that reads the agent's verdict from `$GH_AW_AGENT_OUTPUT` and exits non-zero when Important findings exist. The implementation proved it cannot be the gate on its own: gh-aw gates every custom safe-output job on the agent's emitted output types (`contains(needs.agent.outputs.output_types, 'review_verdict')`), a user-supplied `if:` is merely **ANDed** with that condition (verified in the compiled lock file), and a **skipped** job reports as passing for a required check. So a run in which the agent never emitted a verdict — model non-compliance, a no-op run, or a cut-off agent — would leave the gate green with no review ever produced, contradicting the spec's "Review failure is reported, not silent". The first real review of this change found exactly this hole.

Chosen approach: the required check is reported by a **companion gate workflow** (the fallback this section originally documented) that always reports, whatever the review run did:

- The review workflow still emits a machine-readable verdict and its `review-verdict` job still fails when Important findings exist.
- A small plain-Actions workflow, triggered by `workflow_run: [completed]` on the review workflows, reports one required check per pull request: the agent job skipped (pause, fork, budget cap) → success; agent succeeded and `review_verdict` succeeded → success; agent succeeded without a verdict, `review_verdict` failed, or the agent failed → **failure** (fail closed, with a message distinguishing "findings" from "no review produced"), so the check can never be silently absent.
- Because `cancelled` is not a passing required check, the review workflows must not cancel superseded runs: `cancel-in-progress` is dropped in favour of plain serialisation (`group` only).
- The ruleset is updated to require **only** this companion check, after one real run confirms its exact name — not the review workflow's job checks, whose skip semantics are exactly what made the first attempt unsound. The confirmed name is **`Agentic PR review`**, reported by `pr-review-gate.yml` (task 5.1) — later renamed to **`PR review gate`** in #55, while the guard job's check became `agent-config drift check` in #52; `REVIEW.md` carries the gate's new name (`PR review gate`); the guard job's check became `agent-config drift check` in #52.

Rejected: blocking via a `REQUEST_CHANGES` review. It depends on the agent choosing an event, interacts badly with our existing required-approval and last-push-approval rules, and does not produce a status check anyone can require.

Rejected: `safe-outputs.create-check-run` as the gate. It is agent-driven, so a run that produces no check run leaves the required check pending forever — the property D4 exists to avoid.

### D5. Fork pull requests: skipped, using gh-aw's default

gh-aw blocks inbound fork pull requests by default (a repository-identity check on the `pull_request` trigger), which is exactly the desired behavior: fork pull requests never receive repository secrets, so a BYOK review could not run anyway. The `forks:` allowlist is explicitly **not** used.

Open consequence (see Open Questions): whether a skipped job satisfies the required check must be verified on a real fork pull request before the ruleset change.

### D6. Output: comment reviews only

`safe-outputs` for this workflow:

```yaml
safe-outputs:
  create-pull-request-review-comment:
    max: 10
  submit-pull-request-review:
    allowed-events: [COMMENT]
    max: 1
  noop:
    report-as-issue: false
  report-failure-as-issue: false
  report-failed-jobs: false
```

`allowed-events: [COMMENT]` is infrastructure-level enforcement: the agent cannot approve or request changes even if its output says so. Blocking is the gate's job (D4). One review per run with at most 10 inline comments bounds verbosity, and the summary travels as that review's body (the prompt requires it), so the workflow writes **no conversation comments at all** — the only ones it ever produces come from the paused-notice companion (D10).

The three reporting switches keep a review run from opening repository issues (both `[aw] No-Op Runs` and `[aw] Detection Runs` were created by the spike runs before these were set). `noop.report-as-issue` and `report-failure-as-issue` are documented per handler; v0.88.7 has no `threat-detection.report-as-issue` yet (the compiler rejects it), which is why the broader `report-failed-jobs: false` is used as well — task 1.8, to be confirmed by observing a failing or no-op run produce no issue.

Observation settled that question the hard way: even with `report-failure-as-issue: false`, `report-failed-jobs: false` (rejected at the top level; accepted under `safe-outputs` but ineffective) and `noop.report-as-issue: false`, a failing run still emitted `GH_AW_REPORT_FAILED_JOBS: "true"` in the compiled lock file and opened `[aw] Failed jobs: PR Review` issues (#19, #20, #21 — all closed by hand). Since the frontmatter cannot suppress that path in v0.88.7, the chosen mitigation is a deterministic companion, `agentic-noise-cleanup.yml`, which closes bot-created `[aw] ` issues that carry the `agentic-workflows` label and leaves a comment pointing at the run, so the detail stays available while the issue list stays clean (tasks 7.8/7.16). `REVIEW.md` tells reviewers the same thing.

For reference while reading the specs, these are the distinct GitHub objects involved, and why the workflow uses each safe output:

| GitHub object | What it is | Effect on merging | Used here as |
|---|---|---|---|
| Conversation comment | An ordinary comment in the pull request's discussion | None | Not used by the review itself — the summary is the review body; only the paused-notice companion (D10) writes one |
| Submitted review | A review with a state: `Comment`, `Approve`, or `Request changes` | `Request changes` blocks a merge while a required-approval rule applies; `Approve` can satisfy one | `submit-pull-request-review`, restricted by `allowed-events: [COMMENT]` |
| Inline review comment | A comment anchored to a line of the diff | Not blocking by itself, but unresolved threads block under this repository's `required_review_thread_resolution` rule | `create-pull-request-review-comment` (max 10) |
| Reviewer request | Adding an account to the pull request's Reviewers list (a notification, not content) | Not blocking | Not used; `add-reviewer` is deliberately left out |
| Status check | A check run in the pull request's Checks area (`success`, `failure`, `skipped`) | This is the only thing the merge gate requires | The gate's own job status (D4) |

The policy is not repeated anywhere in this change: the prompt instructs the agent to read `REVIEW.md` from the checked-out pull request head branch and apply it, so a pull request can test its own policy edits (for example a changed pass name or nit limit) and nothing in the workflow hard-codes policy values. The prompt names the policy's *sections to consult*, never their contents — duplicating the contents would create a second source of truth that silently drifts from `REVIEW.md`, whose whole purpose is to be the only one.

### D7. Cost profile

Triggered once per readiness plus manual re-runs, so an active PR typically costs one or two reviews. DeepSeek off-peak rates are $0.15/M cache-miss input and $0.6/M output (peak is double; peak hours cover 14:00–18:00 Asia/Shanghai on weekdays). Threat detection adds one more model call. Actions minutes are free for this public repository. `gh aw logs` and `gh aw forecast` are the observability tools; `timeout-minutes` stays at the 20-minute default.

### D8. Credential handling

`DEEPSEEK_API_KEY` is a repository secret referenced only from `engine.env` through the BYOK credential variables, which gh-aw explicitly permits under strict mode and keeps out of the agent container (the agent sees a dummy key; the real one lives in the API proxy sidecar). The compiled workflow's metadata lists referenced secrets, and gh-aw's unconditional secret-redaction step masks secret values in `/tmp/gh-aw` artifacts. The secret is never written into the repository, the prompt, or the Markdown body.

### D9. Reproducibility and drift

- Pin `engine.version` and the gh-aw release reference used by the compiled workflow. The author-side CLI is pinned to the latest stable release, **`v0.88.7`** (2026-09-08) — chosen over the v0.89.x pre-releases so the lock file stays reproducible (applied in task 1.1).
- Commit the Markdown source, its `.lock.yml`, and the centralized dispatcher; run `gh aw init` once so `.gitattributes` marks compiled files correctly. Initialized with `gh aw init --engine copilot --no-mcp --no-skill --no-agent`, which touched only `.gitattributes` (adding `*.lock.yml linguist-generated=true`) — no extra scaffolding entered the repository (applied in task 1.2).
- Extend the existing `agent-config` guard job: after `pnpm install`, install the pinned gh-aw version and recompile, then fail if the working tree changes (this mirrors the existing rulesync drift check and satisfies the spec requirement).
- Upgrade gh-aw only in dedicated PRs, matching the repository's existing pinning policy for rulesync/OpenSpec tooling.

### D10. Pause switch: a repository variable, not a disabled workflow

An operator must be able to stop reviews for a day without coordinating a pull request. Chosen mechanism: a repository variable consulted from the workflow's top-level `if:`.

```yaml
if: vars.PR_REVIEW_ENABLED != 'false'
```

- Setting `PR_REVIEW_ENABLED=false` stops every new run before the agent job — including `/review` re-runs dispatched through the centralized command path, because the switch gates the workflow as a whole — so the run reports as skipped, no model request is made, and no review content is written. Removing the variable (or setting any other value) restores reviews on both paths.
- The reason this must be a variable rather than "just turn the workflow off" is the interaction with D4: a **skipped** job reports "Success" and does not block a merge even when its check is required, whereas a workflow **disabled in the Actions UI** reports nothing at all — so once the gate is required, disabling it would leave every pull request stuck on `Expected — Waiting for status to be reported`.
- Pausing is quiet, but not mute. **Automatic** runs stay silent: the accepted signal that no review happened is the check's skipped state, visible in the pull request's checks list, the Actions run conclusion, and `gh aw status`; the trade-off — a skipped check does not block a merge and can be misread as "review passed" — is accepted and documented in `REVIEW.md` (task 6.1). An explicit `/review`, by contrast, is answered with a short deterministic reply naming the **automated** review as the paused subject, saying the pause is deliberate, and stating that human review is unaffected (task 8.2 — the first wording, "reviews are paused", was read as human review being paused): someone who asked and got silence cannot tell a paused system from a broken one. That reply must be produced deterministically (the agent is not running and no model request is allowed) and must not appear on the automatic path, so gh-aw's own `status-comment` cannot serve as the mechanism — its text is fixed and it is not event-scoped or pause-aware (D3). Candidate mechanisms were a gh-aw `on.steps` pre-activation step (needs `on.permissions: pull-requests: write` plus a `paused` output the top-level `if:` consumes) or a separate minimal Actions workflow. **Chosen (task 1.7): the separate workflow**, `pr-review-paused-notice.yml`, which listens for `issue_comment` and replies only while paused — it depends on no gh-aw internals, costs no agent run, and cannot be broken by a change in gh-aw's step/output wiring; the price is one more workflow file. Because `issue_comment` workflows run from the default-branch version of the file, it only takes effect after merge, so its end-to-end check rides along with task 5.4.

Alternatives considered: disabling the workflow (rejected once the gate lands, for the reason above; still fine during the pre-gate phase); removing the check from the ruleset (kept as break-glass, too blunt for a routine one-day pause); revoking `DEEPSEEK_API_KEY` (rejected: the run fails instead of skipping, which wedges the check and produces a confusing error); gh-aw's `stop-after` (rejected: no run is created at all, same wedge, and extending it needs a recompile).

### D11. Budget guardrails

One working cap, one configured but inert (see the bullet below — verified on the drill pull request #46), both intended to skip the agent rather than leaving the gate unreported:

- `max-ai-credits` — per-run budget (gh-aw default 1000 AIC = $10; threat detection has its own 400 AIC cap).
- `max-daily-ai-credits` — intended as a daily budget for **this workflow**, summed over its own runs in a rolling 24-hour window, regardless of who triggered them. **It does not work here**: verified on the drill pull request #46 with the cap set to 1, where the agent still ran because gh-aw v0.88.7's activation guardrail computes `aic: 0` for these fallback-priced runs (task 2.6 records the log lines). It stays in the frontmatter with a comment saying so, and task 8.5 decides the replacement (report upstream, implement a deterministic daily guard, or rely on the per-run cap alone).

Two properties matter operationally:

- The daily guardrail, were it working, would have applied to the automatic workflow only: the on-demand path uses the inline `/review` command, not a centralized dispatcher (task 2.5 — that dispatcher no longer exists), and exemption semantics for command runs are gh-aw's. As it stands the daily cap throttles nothing (above), so the pause switch (D10) and the per-run cap are the controls that cover both paths.
- AIC is a derived estimate (tokens × catalog pricing; 1 AIC = $0.01). A model absent from AWF's catalog is priced from a conservative fallback rate, so a cap can trip earlier than the provider's real charges, and the accounting is best-effort by design. These caps are fuses, not accounting: task 4.5 reconciles `gh aw logs` AIC against the DeepSeek dashboard, and the pause switch remains the deterministic lever.
- The guardrail only functions if every model it accounts for can be priced at all, which is why D2's fallback pricing is load-bearing rather than cosmetic: with it, the spike's probe run reported AIC 0.639 for 82,370 tokens; without it the proxy refuses to serve the model with HTTP 400 before `max-ai-credits` can even be consulted.

## Risks / Trade-offs

- **DeepSeek rejects the Copilot CLI's request shape** (tool calling/streaming/thinking-mode quirks) → **resolved by the task 1.4 spike**: the agent completed real shell tool calls and correctly identified its model. The gate is still inert until the ruleset change lands.
- **A BYOK model the API proxy cannot price is refused outright** (HTTP 400 for `deepseek-flash`, before any request reaches DeepSeek) → D2's `models.default-ai-credits-pricing` fallback; the failed spike run stands as the regression evidence that this setting must stay in place.
- **gh-aw's framework issues would pollute the repository** — the spike opened `[aw] No-Op Runs` and `[aw] Detection Runs`, both since closed → task 1.8 established that **no frontmatter setting suppresses that path in v0.88.7** (the compiled env vars stay `true`), so the goal was reached the other way round: a deterministic sweep closes those issues (7.16, verified in 8.3). Review runs therefore **do** open them, and `REVIEW.md` tells readers so.
- **`deepseek-flash` is absent from AWF's catalog** → `model-fallback: false` plus `api.deepseek.com` in the allowlist; if AWF still rewrites the model, add `sandbox.agent.targets.copilot` overrides.
- **A required check that never reports blocks every merge** → the gate is designed to always report; a fork pull request test is a required validation step; the ruleset change is the last step and is reverted in one click if wrong.
- **Fail-closed on provider outage** blocks merges until a re-run succeeds → accepted deliberately (`/review` re-runs; the `protect` ruleset's repository-role bypass remains available for emergencies).
- **gh-aw is a technical preview** and lock files churn between releases → pinned versions, dedicated upgrade PRs, and the compile-drift check make churn visible and reviewable.
- **Reviewing untrusted content** from public PRs → AWF sandbox with read-only permissions, no secrets in the agent container, safe-outputs validation, threat detection on the agent's output, and `min-integrity: approved` applied automatically for public repositories. Detection **flags**; in the configuration this change shipped it published the review with a caution banner rather than blocking (4.4), the merge gate was what failed closed, and 8.5 records the decision to switch detection to blocking.
- **Review noise / false Important findings** → the workflow lands before the gate, so the team can calibrate `REVIEW.md` and the prompt on real PRs first.
- **Pausing the wrong way would block every merge** → the pause switch (D10) is a repository variable implemented from day one and documented in `REVIEW.md`; disabling the workflow is explicitly forbidden once the required check is live, and the pause/resume drill (task 5.4) proves the check still passes while paused.
- **A paused run is easy to misread as a passing review** (the check reports as skipped, which does not block a merge) → accepted for automatic runs, where `REVIEW.md` documents that "skipped" means "not reviewed" and how to confirm the pause state (task 6.1); an explicit `/review` is answered with the paused reply so a human asking for a review is never left guessing (D10); the merge gate's own verdict remains the only thing that blocks.
- **AI-credit accounting can disagree with the real DeepSeek bill** (catalog-unknown model priced at a conservative fallback rate, so AIC over-counts; task 4.5 measured ≈1.9×) and **the daily cap does not fire at all** (task 2.6) → treat the per-run cap as a fuse rather than as accounting, rely on the pause switch when the goal is "spend nothing today", and let task 8.5 decide whether to replace the daily guard.

## Migration Plan

1. Land the workflow source, compiled workflows, secret, pause variable, budget caps, and the CI drift check. Reviews run and comment, but nothing gates (no ruleset change).
2. Observe a handful of real PRs; tune the prompt, the budget values, and the `REVIEW.md` interpretation. Revert is a plain `git revert`, or pause via `PR_REVIEW_ENABLED=false`.
3. After the verdict check's exact name is confirmed and a fork pull request has been verified, add the required check to the `protect` ruleset (repository admin action).
4. Rollback: first pause with `PR_REVIEW_ENABLED=false` (keeps merges flowing), then remove the required check from the ruleset, then disable or revert the workflow. Never disable the workflow while the check is required. The secret can be revoked independently.

## Open Questions

- Do job-level `skipped` checks satisfy the required check for fork pull requests, or is the companion gate workflow needed? Answered by the fork-PR validation task, which runs before the ruleset change.
- Does DeepSeek's default thinking mode add unacceptable latency for PR feedback? Answerable from the first real runs; tuning it does not change the specs.
- Which AI-credit guard to rely on: 2.6 showed the daily cap cannot fire for this model, so the open question is whether to keep the inert value, replace it with a deterministic daily guard of our own, or rely on the per-run cap alone — task 8.5.
