# Design

## Context

See proposal.md — Why for motivation. Facts established during planning (all verified against the live repository):

- The only ruleset is `release-branches` (id 4100518, active), scoped to `~DEFAULT_BRANCH` + `refs/heads/dev` — both resolve to `dev`. Its rules: `deletion`, `non_fast_forward`, a `pull_request` rule (1 approving review, code-owner review required, all three merge methods allowed), and required status checks limited to `agent-config drift check` and `PR review gate`. Bypass: RepositoryRole admin (actor_id 5) in `pull_request` mode. No classic branch protection exists on any branch; `beta` and `main` are entirely unprotected.
- The six CI workflows (`frontend-ci`, `api-ci`, `mobile-ci`, `cli-ci`, `tooling-ci`, `agent-config`) all trigger on every `pull_request` with no path filters, and select scopes internally via `tooling/ci-scope.mjs` (`docs/CI.md`). This means their check runs always appear on every PR — the precondition for making them required contexts.
- Observed on a recent merged PR: suite job contexts are generic names (`check`, `changes`, `detection`, `conclusion`) and collide across workflows — several check runs share one name on the same commit. Required-check matching by context name is therefore unreliable at the individual-job level.
- The repository already solves an analogous problem for AI review: a dedicated companion gate workflow reports one stable required context (`PR review gate`) that fails closed (`.github/workflows/pr-review-gate.yml`). The same pattern fits the CI suites.
- Deploy workflows (`api-deploy`, `web-deploy`) run on `pull_request_target` closed events for `dev`/`beta`/`main` and report their conclusions as check runs on the merged commit — queryable through the API as beta-environment deployment evidence.
- Reading repository rulesets via the REST API requires Administration read permission; the workflow `GITHUB_TOKEN` cannot be granted it, so the scheduled drift check needs a PAT or GitHub App credential.

## Goals / Non-Goals

**Goals:**

- Per-branch rulesets that enforce the contracts in the spec delta, including structural merge-commit-only enforcement on `beta`/`main`.
- Required application CI on `dev` (and on `beta` at batch entry) without breaking ci-scope selection.
- A single composite `promotion integrity` check covering source-branch provenance and prior-stage validation evidence.
- Codified ruleset JSON + scheduled drift detection; ruleset mutation stays a deliberate human operation.

**Non-Goals:**

- Expand-contract / backward-compatible DDL policy and its dev-side compatibility gate. The shared-database coupling that motivated it is real, but it is a data-migration capability concern and lands as its own follow-up change.
- Building a beta-environment smoke suite. This design consumes existing deploy-workflow conclusions as the beta evidence; a dedicated smoke suite is a later increment.
- Automatic ruleset application from CI, and a GitHub App for the drift-check token (a PAT is the interim credential; see Decisions).
- Changing which events trigger deploy/release workflows.

## Decisions

### D1: Per-suite gate jobs with stable unique names, instead of requiring existing job contexts

Each application CI workflow gets a terminal gate job (`needs:` all suite jobs, `if: always()`) that fails when any needed job failed and succeeds otherwise — skipped jobs count as success, which is exactly ci-scope semantics. Gate job names are unique across all workflows and documented as ruleset-referenced contracts (like `agent-config drift check` today): `Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate`.

Why not require existing job contexts: they collide across workflows (`check` × N on one commit), and GitHub matches required checks by context name — ambiguous names make the gate unreliable. Why a summary job instead of renaming every job: one context per suite keeps the ruleset readable and the rename surface minimal. Precedent: `PR review gate` exists for the same reason ("a *skipped* job counts as passing for a required check — so a run that produced no verdict would silently pass" is the failure mode it closes; here the skipped-is-passing semantics are what we *want*, with failure closed on real failures).

The workflow contract tests (`tooling/ci-workflow.test.mjs`) gain assertions that these gate jobs exist with their exact names, so a rename fails CI before it strands required contexts at "Expected".

### D2: One composite `promotion integrity` check for beta/main, instead of ruleset-native restrictions

Rulesets cannot restrict a pull request's head branch, and cannot express "the head already passed stage N's validation". A small workflow (`promotion-gate.yml`, `on: pull_request_target` for `beta`/`main` — a workflow-level branch filter is safe here because the required context exists only in the beta/main rulesets, matching the filter exactly) runs one job (`Promotion gate runner`) whose script asserts:

1. Assert head ref ∈ {`dev`, `hotfix/*`} when base is `beta`; ∈ {`beta`, `hotfix/*`} when base is `main`, and that the head branch lives in this repository — a fork branch named `dev` inherits none of the gates this allowlist assumes.
2. Query check runs on the head SHA and require the six suite gates to be completed successfully (skipped conclusions count as success: the suite genuinely did not apply to the diff). Only check runs reported by the GitHub Actions app satisfy a gate — a same-named check from another app is not the workflow contract.
3. For base `main` with head `beta`: additionally require successful beta-environment deployment evidence. Deploy workflows triggered by `pull_request_target` attach their conclusions to the merged pull request's head SHA, not to the merge commit the merge created (verified against the live repository), so the gate resolves promotion head → the merged PR that produced the `beta` tip → that PR's head SHA → `beta` deployment records → the `api-deploy`/`web-deploy` run conclusions. Hotfix heads skip this evidence.
4. For `hotfix/*` heads: require one approving review from an approver other than the pull request's author (pull-requests API); a later changes-requested or dismissed review revokes that user's approval, self-approval does not count, and API errors fail closed. This assertion lives in the gate rather than the ruleset's `required_approving_review_count` because rulesets cannot condition on the head branch — a ruleset-level review requirement would force reviews onto every promotion, defeating D5.

Trust model and reporting. Running on `pull_request_target` means the workflow file comes from the default branch; the script is additionally checked out from the pull request's base commit, so pull request code is never executed, and permissions are read-only plus `checks: write`. The required context is a check run named `promotion integrity` that the script explicitly creates on the head SHA via the Checks API — not the workflow job's own conclusion (the job is deliberately named `Promotion gate runner` so it can never collide with the required context). Every failure path still creates a failing check run; only an unreportable verdict fails the job, which leaves the context missing and therefore blocks the merge. The suite gates and beta deploys trigger around the same time as the gate, so evidence is polled every 30 seconds to a 45-minute deadline (`PROMOTION_GATE_TIMEOUT_MS`); any completed failure fails immediately, and a timeout names the contexts still outstanding.

`pull_request_review` is deliberately not a trigger: GitHub runs that event's workflow file from the pull request's merge commit, which a same-repository head branch can edit, so a hotfix author could amend the workflow to self-certify the required check. The accepted cost is operational: after a non-author approving review lands on a hotfix, an administrator re-runs the workflow (Actions → re-run all jobs) to re-evaluate the review assertion, and the gate's failure message states this.

Alternatives considered: GitHub "restrict pushes" rules don't apply to PR heads; a merge queue would give stronger "tested-as-merged" guarantees but is a larger operational change and unnecessary while promotions are merge-commit-only (the promotion head tree is what lands). Failing closed on API errors (unknown check shape → fail) matches the `PR review gate` philosophy. Routing hotfixes through `beta` instead of directly to `main` was also considered and rejected: `beta` typically accumulates a batch that is not ready for production, so merging a hotfix into `beta` first and promoting would carry that unready batch into `main`, defeating the hotfix's purpose. Direct-to-`main` hotfixes therefore necessarily diverge the `main` and `beta` trees for a window; the Hotfix flow requirement bounds that window by requiring propagation — merging the same `hotfix/*` branch downstream, so the fix lands as identical commits on every branch — before any further promotion proceeds.

### D3: `allowed_merge_methods: ["merge"]` on the beta/main rulesets; dev keeps all three

The live ruleset already demonstrates that rulesets carry per-branch merge-method restrictions. Restricting `beta`/`main` to merge commits turns the promotion/sync-back SHA-convergence discipline into structure. `dev` keeps all three methods: task PRs keep their merge-style freedom, and sync-back PRs targeting `dev` still need merge commits (available).

### D4: Drift detection is read-only and scheduled; application is a human-invoked local script

One tooling script (`tooling/rulesets.mjs`) with three modes:

- `export`: fetch live rulesets, normalize (strip `id`, timestamps, and other server-assigned fields; canonical key ordering), write `.github/rulesets.expected.json`.
- `check`: fetch live, diff against the committed JSON, print per-rule differences; exit non-zero on drift. Used by the scheduled workflow.
- `apply`: push the codified JSON to the API (create/update rulesets by name). Run locally by the human administrator with their own `gh` auth; never in CI.

Why not auto-apply from CI: mutation credentials in CI turn every workflow compromise into a protection-removal primitive; drift should page a human decision, not self-heal. The scheduled workflow (`ruleset-drift.yml`, daily off-peak cron + `workflow_dispatch`) runs `check` mode and opens/updates one tracking issue on drift.

Credential: a fine-grained PAT with repository Administration:read, stored as the Actions secret `RULESETS_READ_TOKEN`. Alternative considered: a dedicated GitHub App — more durable (no expiry, not person-bound) but adds app creation/installation/key management now; recorded as a follow-up when PAT rotation becomes annoying. The workflow fails visibly (issue) when the token is missing or expired, so silent non-detection is bounded.

### D5: dev ruleset update adds the six suite gates; beta adds gates + promotion integrity; main adds promotion integrity only

- `dev` required contexts: `agent-config drift check`, `PR review gate`, + 6 suite gates. Review requirements unchanged.
- `beta` required contexts: `promotion integrity` + 6 suite gates (batch validated as a whole at entry). No review requirement.
- `main` required contexts: `promotion integrity` only — content was gated at `beta` entry and exercised in the beta environment; re-running suites on `main` promotions buys nothing and adds flaky-blocker surface on already-validated content. Hotfix heads additionally require one non-author approving review, asserted inside `promotion integrity` (D2 step 4), not by the ruleset.

## Risks / Trade-offs

- [A renamed gate job strands its required context at "Expected", silently blocking all merges to that branch] → Workflow contract tests assert the exact gate names; the ruleset drift check also compares required contexts, so a rename that slips through still pages within a day.
- [Flaky suite failures now block merges on `dev`] → Skipped scopes still pass; flaky failures become visible merge-blockers, which is the intended pressure to fix or quarantine them. The admin `pull_request` bypass remains for genuine emergencies.
- [`promotion integrity` misreads an API shape it has never seen] → Fail closed, like `PR review gate`; a wrong failure blocks one promotion until a human looks, never merges something unvalidated.
- [PAT expires and drift detection silently stops] → The workflow opens an issue on token failure too, so expiry is loud.
- [Ordering: workflows merged to `dev` but rulesets not yet applied leaves a window where new checks are unenforced] → Migration plan sequences application immediately after merge; until then enforcement is unchanged from today, so the window adds no new risk.
- [The beta deployment evidence depends on deploy workflows reporting on the head SHA] → If a future deploy workflow stops reporting per-commit conclusions, `promotion integrity` fails closed on missing evidence; the drift between "deployed" and "reported" becomes a visible promotion blocker rather than a silent skip.

## Migration Plan

1. Land this change on `dev`: gate jobs, `promotion-gate.yml`, `ruleset-drift.yml`, `tooling/rulesets.mjs` + tests, `.github/rulesets.expected.json` (desired end state), rulesync source updates + regenerated agent files, `docs/CI.md` update.
2. Human creates the `RULESETS_READ_TOKEN` secret (Administration:read PAT).
3. Human runs `node tooling/rulesets.mjs apply` (own admin auth): creates the `beta`/`main` rulesets, updates `release-branches` (dev) required contexts. Verify with `check` mode → no drift.
4. Exercise in the running environment (records into `validation.md`): open a test promotion PR `dev`→`beta` and observe `promotion integrity` + gate contexts report; attempt a direct push to `beta` and confirm rejection (admin bypass is `pull_request`-mode, so even the admin's direct push is rejected); confirm the GitHub merge UI offers only "Create a merge commit" on the test PR.
5. Drift schedule runs daily from the default branch; first run after application must report no drift.
6. Rollback: set the new rulesets to `enforcement: disabled` via API and drop the added required contexts on `dev` — fully reversible, no code rollback needed.

## Open Questions

- Beta smoke suite content (what to exercise beyond deploy success) — follow-up change, does not alter this design: `promotion integrity` consumes whatever beta-evidence checks exist by name.
- GitHub App vs PAT for the drift credential — PAT is the interim decision; upgrading later changes only the workflow's token source.
