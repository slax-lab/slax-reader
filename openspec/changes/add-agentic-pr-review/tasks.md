## 1. Preparation and spikes

- [x] 1.1 Install the `gh-aw` CLI extension at a pinned version — installed `v0.88.7` (latest stable, 2026-09-08) and recorded the pin in design D9; the version goes into the PR description with task 6.2
- [x] 1.2 Run `gh aw init` in the repository and verify it only adds `.gitattributes` entries (plus its own scaffolding) — `pnpm exec rulesync doctor --strict` and `git status --short` still show no changes to rulesync-generated files
- [x] 1.3 Store the provider credential as the repository secret `DEEPSEEK_API_KEY` and verify `gh secret list` shows it while the value appears nowhere in the working tree (`git grep -i deepseek` finds only non-secret references)
- [x] 1.4 Spike: verify that the Copilot engine in BYOK mode completes a tool-using turn against `deepseek-flash` — done on the throwaway branch `spike/gh-aw-byok`: run 35329927208 succeeded with real shell tool calls (82,370 tokens, AIC 0.639, 4.2 min); run 35329370946 proved the fallback-pricing requirement by failing with HTTP 400 while consuming 0 tokens; both recorded in design D2
- [ ] 1.5 Spike: decide the verdict mechanism from design D4 by building both candidates (deterministic verdict job reading the agent output vs `create-check-run` plus a companion gate) and verify which one reports a check that can fail a required status check; record the decision in `design.md` before continuing
- [x] 1.6 Confirm how AI-credit accounting behaves for a BYOK model outside AWF's catalog — the compiled AWF config carries `defaultAiCreditsPricing` and `maxAiCredits`, the lock file emits both budget values, and `gh aw logs byok-spike` reports a nonzero `aic` (0.639 for 82,370 tokens); recorded in design D11
- [ ] 1.7 Spike: decide the paused-reply mechanism from design D10 by building both candidates (a pre-activation step posting the reply with `on.permissions: pull-requests: write` and exposing a `paused` output that the top-level `if:` consumes, versus a separate minimal workflow on `issue_comment`) and verify the reply is posted without starting the agent and never appears on the automatic `pull_request` path
- [ ] 1.8 Determine and record which settings suppress gh-aw's framework-created issues (`[aw] No-Op Runs` and `[aw] Detection Runs`, both opened by the spike runs and since closed); verify by running a workflow once and confirming that no new repository issue appears

## 2. Review workflow

- [x] 2.1 Create the review workflows with frontmatter per design D2/D3/D6 — `shared/pr-review-core.md` holds the shared config and prompt, `pr-review.md` carries the `pull_request` trigger (`opened`/`ready_for_review`/`reopened`) and `pr-review-command.md` the inline `/review` command; the shared config carries `engine: copilot` with BYOK env, `sandbox.agent.model-fallback: false`, `models.default-ai-credits-pricing` (required — the API proxy cannot price `deepseek-flash` without it), `network.allowed` including `api.deepseek.com`, `copilot-requests: none`, review-only safe outputs, read-only permissions and the framework-issue suppressions from task 1.8 — verified by `gh aw compile --strict --purge` compiling both workflows cleanly
- [ ] 2.2 Write the prompt body so the review reads `REVIEW.md` from the pull request's head branch and applies it as policy (grouping by its passes, its severity calibration, its finding limits, its recurring-pattern tag, its exclusions) and runs its compliance pass against `openspec/changes/<change-id>/`; the prompt must reference the policy's sections without restating their contents — verify on one real pull request that the posted review follows the policy's structure and limits
- [ ] 2.3 Verify the policy indirection holds: open a pull request that edits a policy value in `REVIEW.md` (for example a pass name or the nit limit) and confirm the review follows the edited policy instead of a value fixed in the workflow
- [ ] 2.4 Implement the verdict output chosen in 1.5 and verify on a real pull request that the submitted review event is `Commented` (never Approved or Changes requested) and that the pull request shows exactly one consolidated review
- [x] 2.5 Disable the built-in `/help` command and keep `status-comment: false` (reaction `eyes` stays) — `.github/workflows/aw.json` sets `strict: true` and `help_command: false`; no centralized dispatcher exists any more because the command path uses the inline strategy in `pr-review-command.md`; the `/review` end-to-end check (eyes reaction, no started/completed comments) is deferred to task 4.1 because comment-triggered workflows run from the default branch
- [ ] 2.6 Set the budget guardrails per design D11 (`max-ai-credits`, `max-daily-ai-credits`), recompile, and verify the compiled workflow carries both; then verify a deliberately tiny daily cap skips the agent job and reports the exceeded-budget context instead of failing silently
- [ ] 2.7 Add the pause switch per design D10 (`if: vars.PR_REVIEW_ENABLED != 'false'`) and verify with the repository variable set to `false` that a newly opened pull request is skipped with nothing written to it, that a `/review` comment is skipped but answered with the eyes reaction and a single "reviews are paused" reply, and that with the variable unset or `true` both paths review normally
- [ ] 2.8 Commit the compiled `.github/workflows/pr-review.lock.yml` together with its Markdown source and the `.gitattributes` change; verify `gh aw compile` afterwards leaves `git status` clean

## 3. CI guard for compiled workflows

- [ ] 3.1 Extend the `guard` job in `.github/workflows/agent-config.yml` to install the pinned `gh-aw` version, recompile, and fail when the working tree changes; verify locally by editing a frontmatter field, running the same commands, and confirming a non-empty diff fails the check
- [ ] 3.2 Verify the guard job passes on a pull request that only edits the workflow's Markdown body (no frontmatter change, no recompilation needed)

## 4. End-to-end verification

- [ ] 4.1 On a same-repository pull request, verify all trigger scenarios and record run links: exactly one review on open, none on push, one on `/review`, and none for a `/review` comment from an actor without write access — note that `/review` reaches the workflow through `workflow_dispatch`, which requires the workflow to exist on `main` (design D3), so verify that path after the change is on `main` and record how the dispatcher resolves the target ref
- [ ] 4.2 On a pull request opened from a fork, verify no secret is consumed, no agent execution occurs, and the required-check semantics behave per design D4/D5 (if a skipped job does not satisfy the required check, implement the companion gate workflow and re-verify)
- [ ] 4.3 Calibrate for false positives by reviewing the results on three real or historical pull requests and record the Important-finding rate; adjust the prompt and the `REVIEW.md` interpretation, then recompile
- [ ] 4.4 Verify credential isolation and write isolation: the real key is absent from the agent container environment and from all run artifacts/logs, and a deliberately malformed agent output is blocked by threat detection before any comment is posted
- [ ] 4.5 Reconcile AI credits with real spend: run a normal review, record that run's `aic` and token counts from `gh aw logs`, compare them with the DeepSeek usage dashboard for the same window, and record the deviation and whether the model resolved in AWF's catalog

## 5. Merge gate rollout

- [ ] 5.1 Take the exact status-check name from a completed run and record it in the change's PR description
- [ ] 5.2 Repository admin adds that check to the `protect` ruleset's required status checks (on top of the existing `guard` check); record the ruleset JSON before and after
- [ ] 5.3 Verify gating on two pull requests: one with an Important finding shows a failing required check that blocks merge, and one with only nits shows a passing check that allows merge
- [ ] 5.4 Run the pause/resume drill with the gate live: with `PR_REVIEW_ENABLED=false`, verify the required check reports a passing result and an un-reviewed pull request can still merge, that an opened pull request stays silent while a `/review` comment gets the eyes reaction plus the paused reply, and record what the pull request actually shows so the documented signal matches reality; with the control restored, verify the next pull request is reviewed and the check reflects its verdict

## 6. Wrap-up

- [ ] 6.1 Add an "Automated review" section to `REVIEW.md` documenting how to re-run the review (`/review`), what the status check means, how to pause and resume reviews (`PR_REVIEW_ENABLED`), what a paused pull request looks like (automatic runs leave only a skipped check — so "skipped" must not be read as "reviewed and clean" — while a `/review` comment is answered with a single "reviews are paused" reply) and how to confirm the pause state from the Actions run or `gh aw status`, the budget caps in force, and how to bypass the gate in an emergency; verify the file still passes `pnpm exec rulesync doctor --strict`
- [ ] 6.2 Open the pull request with an `OpenSpec: add-agentic-pr-review` line in its body, include the pinned `gh-aw` version (`v0.88.7`), the verdict-check name, and gh-aw's security-review note for the compilation (list the newly introduced secret `DEEPSEEK_API_KEY` and the pinned actions and containers from the lock manifest, confirming each was reviewed), and verify `pnpm exec openspec validate --all --strict` passes
- [ ] 6.3 After merge, archive the change with `openspec archive add-agentic-pr-review` and verify the new capability spec appears under `openspec/specs/agentic-pr-review/spec.md`

## 7. Findings from the first real review (PR #18)

The review workflow's first run reviewed its own implementation pull request and reported two Important findings plus three Nits. They are tracked here because they are all still actionable:

- [x] 7.1 Fix the gate so a run producing no verdict cannot pass silently — attempted by overriding the custom job's `if:`, which the compiler merely **ANDs** with its own output-types gate (verified in the compiled lock file), so the verdict job alone cannot be the gate; the companion workflow from design D4 is required instead
- [ ] 7.2 Implement the companion gate workflow (design D4): `workflow_run`-triggered, always reporting one required check — agent skipped (pause/fork/budget) → success, `review_verdict` succeeded → success, missing verdict or agent failure → failure with a message distinguishing findings from "no review produced"
- [ ] 7.3 Drop `cancel-in-progress` from both review workflows: a cancelled run is not a passing required check, so superseding a run must not happen
- [ ] 7.4 Skip draft pull requests (`github.event.pull_request.draft == false`) so a pull request is not reviewed twice (on open and again on ready_for_review)
- [ ] 7.5 Gate the paused-notice companion on the commenter's repository role, so an unauthorized `/review` cannot make the bot write a comment (the spec requires such requests to be ignored)
- [ ] 7.6 Reconcile the spec's trigger list with the implementation: `reopened` is implemented but not specified
- [ ] 7.7 Correct the PR body and task 5.2 so they name the single required check the companion reports, not the review workflow's job checks
- [ ] 7.8 Finish suppressing framework issues: the first real review run (`pr-review`, failed verdict) still opened `[aw] Failed jobs: PR Review` (#19, closed) even with `report-failure-as-issue: false`, `report-failed-jobs: false` and `noop.report-as-issue: false`, so another reporting path exists; find and set the switch that covers it and re-verify with a failing run
