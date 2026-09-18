## 1. Preparation and spikes

- [ ] 1.1 Install the `gh-aw` CLI extension at a pinned version and record `gh aw version` output in the change's PR description
- [ ] 1.2 Run `gh aw init` in the repository and verify it only adds `.gitattributes` entries (plus its own scaffolding) — `pnpm exec rulesync doctor --strict` and `git status --short` still show no changes to rulesync-generated files
- [ ] 1.3 Store the provider credential as the repository secret `DEEPSEEK_API_KEY` and verify `gh secret list` shows it while the value appears nowhere in the working tree (`git grep -i deepseek` finds only non-secret references)
- [ ] 1.4 Spike: add a throwaway workflow that runs the Copilot engine in BYOK mode against `deepseek-flash` and verify with `gh aw run` that the agent completes a tool-using turn; record wall-clock time, token usage (`gh aw logs`) and whether `sandbox.agent.model-fallback: false` is required to avoid a 404
- [ ] 1.5 Spike: decide the verdict mechanism from design D4 by building both candidates (deterministic verdict job reading the agent output vs `create-check-run` plus a companion gate) and verify which one reports a check that can fail a required status check; record the decision in `design.md` before continuing

## 2. Review workflow

- [ ] 2.1 Create `.github/workflows/pr-review.md` with frontmatter per design D2/D3/D6 (`pull_request` on `opened`/`ready_for_review`, centralized `/review` slash command, `engine: copilot` with BYOK env, `sandbox.agent.model-fallback: false`, `network.allowed` including `api.deepseek.com`, review-only safe outputs, read-only permissions) and verify `gh aw compile pr-review --strict` succeeds with no errors
- [ ] 2.2 Write the prompt body so the review must apply `REVIEW.md` (three passes, Important-vs-Nit calibration, five-nit cap, `[REPEAT]` tagging, do-not-report list) and run the compliance pass against `openspec/changes/<change-id>/`; verify on one real pull request that the posted review uses the three pass headings and respects the nit cap
- [ ] 2.3 Implement the verdict output chosen in 1.5 and verify on a real pull request that the submitted review event is `Commented` (never Approved or Changes requested) and that the pull request shows exactly one consolidated review
- [ ] 2.4 Disable the generated `/help` command via `.github/workflows/aw.json` and commit the centralized dispatcher workflow that gh-aw generates; verify `gh aw status` lists the review workflow and the dispatcher as enabled
- [ ] 2.5 Commit the compiled `.github/workflows/pr-review.lock.yml` together with its Markdown source and the `.gitattributes` change; verify `gh aw compile` afterwards leaves `git status` clean

## 3. CI guard for compiled workflows

- [ ] 3.1 Extend the `guard` job in `.github/workflows/agent-config.yml` to install the pinned `gh-aw` version, recompile, and fail when the working tree changes; verify locally by editing a frontmatter field, running the same commands, and confirming a non-empty diff fails the check
- [ ] 3.2 Verify the guard job passes on a pull request that only edits the workflow's Markdown body (no frontmatter change, no recompilation needed)

## 4. End-to-end verification

- [ ] 4.1 On a same-repository pull request, verify all trigger scenarios and record run links: exactly one review on open, none on push, one on `/review`, and none for a `/review` comment from an actor without write access
- [ ] 4.2 On a pull request opened from a fork, verify no secret is consumed, no agent execution occurs, and the required-check semantics behave per design D4/D5 (if a skipped job does not satisfy the required check, implement the companion gate workflow and re-verify)
- [ ] 4.3 Calibrate for false positives by reviewing the results on three real or historical pull requests and record the Important-finding rate; adjust the prompt and the `REVIEW.md` interpretation, then recompile
- [ ] 4.4 Verify credential isolation and write isolation: the real key is absent from the agent container environment and from all run artifacts/logs, and a deliberately malformed agent output is blocked by threat detection before any comment is posted

## 5. Merge gate rollout

- [ ] 5.1 Take the exact status-check name from a completed run and record it in the change's PR description
- [ ] 5.2 Repository admin adds that check to the `protect` ruleset's required status checks (on top of the existing `guard` check); record the ruleset JSON before and after
- [ ] 5.3 Verify gating on two pull requests: one with an Important finding shows a failing required check that blocks merge, and one with only nits shows a passing check that allows merge

## 6. Wrap-up

- [ ] 6.1 Add an "Automated review" section to `REVIEW.md` documenting how to re-run the review (`/review`), what the status check means, and how to bypass it in an emergency; verify the file still passes `pnpm exec rulesync doctor --strict`
- [ ] 6.2 Open the pull request with an `OpenSpec: add-agentic-pr-review` line in its body and verify `pnpm exec openspec validate --all --strict` passes
- [ ] 6.3 After merge, archive the change with `openspec archive add-agentic-pr-review` and verify the new capability spec appears under `openspec/specs/agentic-pr-review/spec.md`
