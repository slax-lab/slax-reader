# Review instructions

This file is the single source of truth for review policy in this repo. It is read by AI review services (e.g. Claude Code Review), by agents asked to review code, and by human reviewers.

## Passes

Run three passes and tag each finding with its pass:

- **Bugs**: logic errors, broken edge cases, subtle regressions
- **Security**: injection risks, authentication gaps, secrets or PII in logs and error messages
- **Compliance**: the change matches its linked OpenSpec change artifacts (see below)

## What Important means here

Reserve Important for findings that:

- break behavior or introduce a regression
- lose or corrupt user data (bookmarks, highlights, comments)
- leak secrets or PII
- break the cross-app API contracts in `packages/contracts`
- diverge from the intent of the linked OpenSpec change

Style, naming, and refactoring suggestions are Nits at most.

## Cap the nits

Report at most five Nits per review; summarize the rest as a count. If everything you found is a Nit, lead the summary with "No blocking issues."

## Compliance pass

Behavior-changing PRs carry an `OpenSpec: <change-id>` line in the PR body (`n/a` when there is no behavior change).

1. Find the `OpenSpec:` line in the PR body. If the PR touches `apps/**` or `packages/**` and the line is missing, report that as an Important Compliance finding.
2. Read `openspec/changes/<change-id>/`: `proposal.md`, `tasks.md`, `design.md` (if present), and the delta specs under `specs/`.
3. Verify the implementation matches the change's stated intent and that tasks marked complete are actually implemented. Report divergences as Compliance findings.

## Do not report

- Generated agent files: `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.agents/` — rulesync drift is enforced in CI
- OpenSpec structural validity — `openspec validate --all --strict` runs in CI
- `pnpm-lock.yaml`, `node_modules/`, build outputs (e.g. `dist/`)
- Anything else CI already enforces

## Recurring findings

Patterns flagged more than once are tracked here. Before posting a finding, compare it against this list; on a match, tag the finding `[REPEAT]`.

When a human confirms a `[REPEAT]`, the pattern is promoted into the agent rules under `.rulesync/rules/` (followed by `pnpm agent:sync`), so authoring agents avoid it from the next session onward, and the entry is marked `promoted`. Agents must never promote patterns into the rules on their own.

| Pattern | First seen | Date | Status |
| --- | --- | --- | --- |
| _example: request bodies logged at info level_ | _#123_ | _YYYY-MM-DD_ | _watching / promoted_ |

## Automated review

Pull requests are reviewed automatically by a GitHub Agentic Workflow (`gh-aw`) running the Copilot engine in BYOK mode against our own DeepSeek key. This file is its policy: the workflow reads `REVIEW.md` **from the pull request's head branch**, so a pull request can adjust the policy it is reviewed under.

**When it runs.** Once when a pull request is opened, reopened, or marked ready for review (drafts are skipped until they are ready), and on demand whenever somebody with write access comments `/review`. Ordinary pushes do not trigger a review.

**The `PR review gate` status check.** This is the single required check for the automated review; it is reported by the companion workflow of the same name (`pr-review-gate.yml`) after each review run:

| Status | Meaning |
| --- | --- |
| success | Reviewed with no Important findings — or the review was legitimately skipped (paused, fork pull request, budget cap) |
| failure | The review reported at least one Important finding, **or** no review could be produced (the gate fails closed and says which) |

**After you push, ask for a review.** The check is attached to the commit that was reviewed, so a new commit starts without a status and the pull request stays blocked until a re-review runs — comment `/review`. This is deliberate: the gate must not let unreviewed code through, and it cannot know that a new commit is fine on its own. Re-running costs roughly $0.01–0.20 (a large pull request with a big diff costs more).

**Pausing reviews.** Set the repository variable `PR_REVIEW_ENABLED` to `false` to stop the **automated** review for a period; delete it or set any other value to resume. Human review is never paused by this switch — reviewers keep commenting, approving and merging throughout. While paused, automatic runs stay silent — the check reports as skipped, which does **not** mean "reviewed and clean" — and an explicit `/review` is answered with a short comment saying the automated review is paused and that nothing is broken. Pausing never blocks a merge. The notice ends with a machine-readable marker that the Feishu notification bridge parses, so the bridge knows this comment is a pause notice without guessing from its wording; the token itself lives in the workflow file and is deliberately not reproduced here, because this file gets quoted into comments. Which card is sent, and to whom, is that bridge's policy, not this repository's. Do **not** disable the workflow in the Actions UI while the check is required: an unreported required check blocks every pull request (that is why the switch exists).

**Budget.** Each run is capped at `max-ai-credits` and each rolling 24 hours at `max-daily-ai-credits` for this workflow (`pr-review`); hitting a cap skips the run rather than blocking. `/review` runs are exempt from the daily cap.

**If the gate is wrong.** Findings are advice produced by a model: read the review, and if a finding is mistaken, say so on the pull request. To unblock an emergency merge, a repository admin can bypass the check or temporarily remove `PR review gate` from the `protect` ruleset — pause with the variable instead whenever pausing is enough.

**Automation noise.** The framework may open issues titled `[aw] No-Op Runs`, `[aw] Detection Runs` or `[aw] Failed jobs: …` when a run fails or produces nothing. They are automation bookkeeping, not project issues: the failing status check above is the real signal, and closing those issues is safe.
