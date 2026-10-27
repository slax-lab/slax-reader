# Branching and protection

## Scope and change policy

- **Owns:** long-lived branch responsibilities, the protection table, approvals and merge
  methods, task-branch discipline, promotion, sync-back, and hotfix steps.
- **Does not own:** the normative branch rules (`openspec/specs/release-branching/spec.md`),
  the enforced ruleset state (`.github/rulesets.expected.json`), or CI scope and workflow
  mechanics (`docs/CI.md`).
- **Intake:** operational steps and troubleshooting that implement the normative rules. A new
  required context or merge-method restriction enters the spec and the codified ruleset first.
- **Outflow:** when a section becomes normative it moves to the spec; when it becomes CI
  mechanics it moves to `docs/CI.md`. Update the index row and keep old links working.

The repository has three long-lived environment branches — `dev` (the default branch), `beta`, and `main` — and each gates a different decision: `dev` gates individual-change quality, `beta` gates batch release-readiness and has real internal consumers, and `main` gates provenance. The normative contract for each branch lives in `openspec/specs/release-branching/spec.md`; this page describes the operational steps that satisfy it.

## Branch protection and required contexts

Every long-lived branch rejects direct pushes, force-pushes, and deletion, and administrator bypass actors are configured in `pull_request` mode — an administrator can merge an exceptional pull request, but a direct push stays rejected even for them. The branches gate different decisions, so their entry conditions and required contexts differ:

| Branch | Entry rule | Required contexts | Merge methods |
| --- | --- | --- | --- |
| `dev` | Any pull request | `agent-config drift check`, `PR review gate`, `Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate` | merge, squash, rebase |
| `beta` | Head is `dev` or `hotfix/*` | `promotion integrity`, `Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate` | merge commit only |
| `main` | Head is `beta` or `hotfix/*` | `promotion integrity` | merge commit only |

Gate wiring is CI mechanics: the terminal gate-job names, the Node.js runtime coverage, and the way `promotion integrity` carries the suite gates on `main` are owned by `docs/CI.md`. The enforced values in this table are codified in `.github/rulesets.expected.json`; human review checks the table against that file, and the drift workflow in `docs/CI.md` reports divergence.

## Reviews and merge methods

Every pull request to `beta` or `main` requires one approving review from a reviewer other than its author, enforced by the rulesets. For a promotion the content was reviewed when it entered `dev`, so the approval acts as the explicit release decision rather than a repeated content review; for a `hotfix/*` head, which never passed through `dev`, the approval is the content review itself. On `dev`, one approving review including a code-owner review is required.

Only merge-commit merging is permitted on `beta` and `main`, enforced by the rulesets' allowed merge methods, so the promotion and sync-back SHA discipline is structural rather than documented. Rebase and squash forge new SHAs for patches the source branch already carries, and once the histories diverge GitHub's trial-merge gate blocks every merge method until a sync-back merge re-converges them. `dev` keeps all merge methods available, so sync-back pull requests targeting `dev` can still use merge commits.

The human administrator merges promotion, sync-back, and hotfix pull requests from the GitHub UI once the required checks are green; agents never merge them. Self-approval never counts, so a hotfix or promotion authored by an administrator still needs another approver; when no approver is available in time, the administrator's `pull_request` bypass is the exceptional path.

## Task branches

- One task = one branch = one PR: branch `<type>/<task-name>` cut from `origin/dev`, where `<type>` is the commit type of the work, e.g. `feat`, `fix`, `docs`, `chore`, `ci`. The task's pull request targets `dev`. `<task-name>` is one string, used verbatim for the branch suffix and — when a change is required — the OpenSpec change-id.
- Never commit on a long-lived branch (`dev`, `beta`, or `main`): a pre-commit hook rejects the commit locally, and the repository ruleset rejects the push remotely. Trivial fixes (typo scale, single file) also go through a branch and a pull request.
- Before the first file edit of a session, check where you are: if `git branch --show-current` is a long-lived branch, cut the task branch first — `git switch -c <type>/<task-name> --no-track origin/dev` — asking the human first when the checkout carries uncommitted changes.
- Parallel tasks MUST NOT carry delta specs for the same capability (`openspec/specs/<capability>/`); sequence such tasks instead. The non-delegable same-capability obligation is stated in the root agent rules.

## Promotion and sync-back

A promotion pull request carries a batch from `dev` to `beta`, or from `beta` to `main`; its head must be an allowed source branch for the target. A sync-back pull request carries a hotfix or a protected-branch correction in the reverse direction. Merge commits preserve the SHAs the promotion gate compares.

If a promotion pull request reports conflicts from divergence, merge the target branch back into the source branch first (resolving in favor of the source branch's content), then merge the promotion. Sync-back pull requests merge with a merge commit too: a sync-back's entire purpose is making the target branch's tip an ancestor of the source branch, and squash or rebase would forge a new SHA for that tip instead, leaving the divergence — and the blocked promotion — exactly as it was.

One direction has no sync-back pull request at all: a conflicted `beta` → `main` promotion cannot be re-converged by merging `main` into `beta` through a pull request, because `beta`'s source allowlist admits only `dev` and `hotfix/*` heads. That conflict arises only when `main` moved through a hotfix, and the hotfix flow below requires propagating that same `hotfix/*` branch to `beta` before any further promotion — the mandatory propagation is the re-convergence.

## Hotfix flow

When `beta` or `main` needs an urgent fix while the branch that would normally feed it carries changes that are not ready to promote, cut `hotfix/<name>` from the branch that needs the fix and merge it back through a pull request subject to that branch's entry conditions. A hotfix pull request requires one approving review from an approver other than its author — the content never passed through `dev`, where reviews happen — and the rulesets on `beta` and `main` enforce that review exactly as they do for every other pull request to those branches. The administrator's `pull_request` bypass remains for a change that genuinely cannot wait; requiring the review is what keeps the bypass an exceptional act.

Then propagate the same `hotfix/*` branch downstream with merge-commit pull requests — to `dev`, and additionally to `beta` when the hotfix landed on `main` — and start no further normal promotion until that propagation is merged. Merging the same `hotfix/*` branch keeps histories convergent; a propagation pull request headed by the fixed `main` branch would also fail `beta`'s source allowlist, which admits only `dev` or `hotfix/*` heads.

## Promotion mechanics

`PR review gate` can hang at "Expected" when a pull request targeting `dev` is opened with conflicts: the review workflow does not fire for a conflicted pull request, so no run reports on the head. The review triggers include `synchronize`, so the sync-back merge that resolves the conflicts re-triggers the review automatically; if the gate still shows no real status (for example the pull request is still conflicted, so no run fires), posting a `/review` comment runs the on-demand review, after which the gate reports a real status.

## Ruleset drift

The expected ruleset state is codified in `.github/rulesets.expected.json`. The drift workflow, its authentication, and the apply boundary are owned by `docs/CI.md`.
