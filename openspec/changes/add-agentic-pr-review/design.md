# Design — agentic PR review on our own DeepSeek key

## Context

Motivation and scope live in `proposal.md`; the behavior contract is in `specs/agentic-pr-review/spec.md`. What shapes the approach:

- **gh-aw is a compiler, not a service.** A workflow is a Markdown file with YAML frontmatter; `gh aw compile` turns it into a normal GitHub Actions workflow (`.lock.yml`) that must be committed alongside the source. The Markdown body is loaded at runtime, so body edits do not need recompilation — frontmatter edits do.
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
network:
  allowed:
    - defaults
    - api.deepseek.com
```

- `model-fallback: false` is required: AWF's API proxy resolves unknown model names against its built-in catalog and would rewrite `deepseek-flash`, producing an HTTP 404 `model_not_found`.
- `api.deepseek.com` must be listed explicitly because the provider URL travels through a secret-backed variable; gh-aw's automatic allowlist derivation only applies to literal URLs.
- `COPILOT_PROVIDER_TYPE` stays at its `openai` default (Chat Completions). DeepSeek also exposes an Anthropic-format endpoint, but the OpenAI path is the better-tested one for the Copilot CLI.
- Rejected: `deepseek-v4-pro` (higher price, and DeepSeek's own V4.1-Flash benchmark claims supersede it) and `sandbox.agent.token-steering: false` is **not** set initially — only changed if AWF interferes with the configured provider/model.

### D3. Triggers, and the slash-command complication

Automation: `pull_request: types: [opened, ready_for_review]`. Manual: `/review`.

gh-aw cannot combine an inline `slash_command` trigger with `pull_request` (the compiler rejects the conflict), so this workflow uses `on.slash_command.strategy: centralized`. Consequences to handle in implementation:

- The compiler emits an additional `agentic_commands.yml` dispatcher workflow that must be committed too.
- Centralized routing enables a built-in `/help` command by default; set `help_command: false` in `.github/workflows/aw.json` so the bot does not advertise commands we have not curated.

Rejected: splitting automatic and manual review into two workflows (duplicated prompt and policy, two lock files to keep in sync).

### D4. Merge gate: a deterministic verdict, reported as a job-level status

Requirements demand both "fails on Important findings" and "never leaves a check unreported". A check run created by the agent fails the second property — if the agent crashes or the provider is unreachable, nothing is posted and a required check would stay pending forever, blocking every merge.

Chosen approach: the required check is the **job-level status** of a deterministic verdict job inside the review workflow:

- The agent's findings are emitted through `safe-outputs` with a machine-readable verdict.
- A deterministic post-processing job (gh-aw custom job, e.g. `review-verdict`) reads the agent output artifact, exits non-zero when the verdict says "Important findings present", and succeeds otherwise. Run not created → no check; run created but job skipped → status "skipped", which GitHub treats as passing for required checks.
- The ruleset is updated to require this check **only after** one real run confirms its exact name in the Actions UI.

Fallback if reading the agent output from a deterministic job proves impractical: use `safe-outputs.create-check-run` (fixed `name`, agent-chosen `conclusion`) for the verdict and add a small companion workflow that always reports the required check, mapping "no review produced" to a failure. The implementation task starts with a spike that decides between these two, and the ruleset change is sequenced after that decision.

Rejected: blocking via a `REQUEST_CHANGES` review. It depends on the agent choosing an event, interacts badly with our existing required-approval and last-push-approval rules, and does not produce a status check anyone can require.

### D5. Fork pull requests: skipped, using gh-aw's default

gh-aw blocks inbound fork pull requests by default (a repository-identity check on the `pull_request` trigger), which is exactly the desired behavior: fork pull requests never receive repository secrets, so a BYOK review could not run anyway. The `forks:` allowlist is explicitly **not** used.

Open consequence (see Open Questions): whether a skipped job satisfies the required check must be verified on a real fork pull request before the ruleset change.

### D6. Output: comment reviews only

`safe-outputs` for this workflow:

```yaml
safe-outputs:
  add-comment:
    max: 1
  create-pull-request-review-comment:
    max: 10
  submit-pull-request-review:
    allowed-events: [COMMENT]
    max: 1
  noop:
```

`allowed-events: [COMMENT]` is infrastructure-level enforcement: the agent cannot approve or request changes even if its output says so. Blocking is the gate's job (D4). Inline comments are capped at 10 and the summary at 1, which also bounds the review's verbosity; `REVIEW.md`'s five-nit cap is enforced by the prompt.

### D7. Cost profile

Triggered once per readiness plus manual re-runs, so an active PR typically costs one or two reviews. DeepSeek off-peak rates are $0.15/M cache-miss input and $0.6/M output (peak is double; peak hours cover 14:00–18:00 Asia/Shanghai on weekdays). Threat detection adds one more model call. Actions minutes are free for this public repository. `gh aw logs` and `gh aw forecast` are the observability tools; `timeout-minutes` stays at the 20-minute default.

### D8. Credential handling

`DEEPSEEK_API_KEY` is a repository secret referenced only from `engine.env` through the BYOK credential variables, which gh-aw explicitly permits under strict mode and keeps out of the agent container (the agent sees a dummy key; the real one lives in the API proxy sidecar). The compiled workflow's metadata lists referenced secrets, and gh-aw's unconditional secret-redaction step masks secret values in `/tmp/gh-aw` artifacts. The secret is never written into the repository, the prompt, or the Markdown body.

### D9. Reproducibility and drift

- Pin `engine.version` and the gh-aw release reference used by the compiled workflow.
- Commit the Markdown source, its `.lock.yml`, and the centralized dispatcher; run `gh aw init` once so `.gitattributes` marks compiled files correctly.
- Extend the existing `agent-config` guard job: after `pnpm install`, install the pinned gh-aw version and recompile, then fail if the working tree changes (this mirrors the existing rulesync drift check and satisfies the spec requirement).
- Upgrade gh-aw only in dedicated PRs, matching the repository's existing pinning policy for rulesync/OpenSpec tooling.

### D10. Pause switch: a repository variable, not a disabled workflow

An operator must be able to stop automated review for a day without coordinating a pull request. Chosen mechanism: a repository variable consulted from the workflow's top-level `if:`.

```yaml
if: vars.PR_REVIEW_ENABLED != 'false'
```

- Setting `PR_REVIEW_ENABLED=false` stops every new run before the agent job: the run reports as skipped, no model request is made, and nothing is published. Removing the variable (or setting any other value) restores reviews.
- The reason this must be a variable rather than "just turn the workflow off" is the interaction with D4: a **skipped** job reports "Success" and does not block a merge even when its check is required, whereas a workflow **disabled in the Actions UI** reports nothing at all — so once the gate is required, disabling it would leave every pull request stuck on `Expected — Waiting for status to be reported`.

Alternatives considered: disabling the workflow (rejected once the gate lands, for the reason above; still fine during the pre-gate phase); removing the check from the ruleset (kept as break-glass, too blunt for a routine one-day pause); revoking `DEEPSEEK_API_KEY` (rejected: the run fails instead of skipping, which wedges the check and produces a confusing error); gh-aw's `stop-after` (rejected: no run is created at all, same wedge, and extending it needs a recompile).

### D11. Budget guardrails

Two explicit caps, both of which skip the agent rather than leaving the gate unreported:

- `max-ai-credits` — per-run budget (gh-aw default 1000 AIC = $10; threat detection has its own 400 AIC cap).
- `max-daily-ai-credits` — daily budget for **this workflow**, summed over its own runs in a rolling 24-hour window, regardless of who triggered them (gh-aw default 5000 AIC = $50, and `-1` disables it). It is per workflow file — not per repository, per user, or per pull request — so any future agentic workflow gets its own budget.

Two properties matter operationally:

- Manual `/review` runs go through the centralized dispatcher (`workflow_dispatch` carrying `aw_context`) and are **exempt** from the daily guardrail by specification. The daily cap therefore throttles automatic reviews only; the pause switch (D10) is the control that covers both paths.
- AIC is a derived estimate (tokens × catalog pricing; 1 AIC = $0.01). A model absent from AWF's catalog is priced from a conservative fallback rate, so a cap can trip earlier than the provider's real charges, and the accounting is best-effort by design. These caps are fuses, not accounting: task 4.5 reconciles `gh aw logs` AIC against the DeepSeek dashboard, and the pause switch remains the deterministic lever.

## Risks / Trade-offs

- **DeepSeek rejects the Copilot CLI's request shape** (tool calling/streaming/thinking-mode quirks) → smoke-test the workflow with `gh aw run` before touching any ruleset; the whole gate is inert until the ruleset change lands.
- **`deepseek-flash` is absent from AWF's catalog** → `model-fallback: false` plus `api.deepseek.com` in the allowlist; if AWF still rewrites the model, add `sandbox.agent.targets.copilot` overrides.
- **A required check that never reports blocks every merge** → the gate is designed to always report; a fork pull request test is a required validation step; the ruleset change is the last step and is reverted in one click if wrong.
- **Fail-closed on provider outage** blocks merges until a re-run succeeds → accepted deliberately (`/review` re-runs; the `protect` ruleset's repository-role bypass remains available for emergencies).
- **gh-aw is a technical preview** and lock files churn between releases → pinned versions, dedicated upgrade PRs, and the compile-drift check make churn visible and reviewable.
- **Reviewing untrusted content** from public PRs → AWF sandbox with read-only permissions, no secrets in the agent container, safe-outputs validation, threat detection before any write, and `min-integrity: approved` applied automatically for public repositories.
- **Review noise / false Important findings** → the workflow lands before the gate, so the team can calibrate `REVIEW.md` and the prompt on real PRs first.
- **Pausing the wrong way would block every merge** → the pause switch (D10) is a repository variable implemented from day one and documented in `REVIEW.md`; disabling the workflow is explicitly forbidden once the required check is live, and the pause/resume drill (task 5.4) proves the check still passes while paused.
- **AI-credit caps can disagree with the real DeepSeek bill** (catalog-unknown model priced at a conservative fallback rate; daily cap is per workflow and `/review` runs bypass it) → treat the caps as fuses rather than accounting, reconcile actual spend in task 4.5, and use the pause switch when the goal is "spend nothing today".

## Migration Plan

1. Land the workflow source, compiled workflows, secret, pause variable, budget caps, and the CI drift check. Reviews run and comment, but nothing gates (no ruleset change).
2. Observe a handful of real PRs; tune the prompt, the budget values, and the `REVIEW.md` interpretation. Revert is a plain `git revert`, or pause via `PR_REVIEW_ENABLED=false`.
3. After the verdict check's exact name is confirmed and a fork pull request has been verified, add the required check to the `protect` ruleset (repository admin action).
4. Rollback: first pause with `PR_REVIEW_ENABLED=false` (keeps merges flowing), then remove the required check from the ruleset, then disable or revert the workflow. Never disable the workflow while the check is required. The secret can be revoked independently.

## Open Questions

- Do job-level `skipped` checks satisfy the required check for fork pull requests, or is the companion gate workflow needed? Answered by the fork-PR validation task, which runs before the ruleset change.
- Does DeepSeek's default thinking mode add unacceptable latency for PR feedback? Answerable from the first real runs; tuning it does not change the specs.
- Which gh-aw version to pin first, given the tool is in technical preview.
- Which concrete per-run and daily AI-credit caps to adopt: task 2.5 sets provisional values, and tuning them later changes neither the specs nor the approach.
