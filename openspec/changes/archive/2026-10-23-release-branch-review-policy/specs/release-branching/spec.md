# Spec Delta

## MODIFIED Requirements

### Requirement: Per-branch protection contracts

Each long-lived branch SHALL have a protection contract — its state guarantee, allowed write paths, and entry conditions — and the branch rulesets SHALL enforce that contract. All three branches SHALL reject direct pushes, deletion, and non-fast-forward updates. The contracts differ because the branches gate different decisions:

- `dev` gates individual-change quality. Merging a pull request to `dev` SHALL require the `agent-config drift check` and `PR review gate` contexts, the per-suite application CI gate contexts, and one approving review including a code-owner review. Each application CI gate SHALL report exactly one status context with a stable, suite-unique name on every pull request; when a suite's scope is not selected by the pull request's diff, its gate SHALL report success (skipped scopes never block). All merge methods remain available on `dev`.
- `beta` gates batch release-readiness. Changes SHALL arrive only through pull requests whose head branch is `dev` or a `hotfix/*` branch. Merging SHALL require the `promotion integrity` context, the per-suite application CI gate contexts (so the assembled batch is validated as a whole at entry), and one approving review from a reviewer other than the pull request's author.
- `main` gates provenance. Changes SHALL arrive only through pull requests whose head branch is `beta` or a `hotfix/*` branch, and merging SHALL require the `promotion integrity` context carrying the stage evidence for that source and one approving review from a reviewer other than the pull request's author. The stage evidence: for a `beta` head, the head commit MUST have been deployed successfully to the beta environment by every deployment workflow the batch triggered (the deploy workflows are paths-filtered, so a batch that triggered none requires no deployment evidence); for a `hotfix/*` head, the head commit MUST have passed the application CI gates. Content validation is not repeated on `main`, so a tree arriving from `beta` is identical to the tree the `beta` stage validated. A `hotfix/*` head is the only sanctioned divergence from that identity — it carries content `beta` never validated — and the Hotfix flow requirement bounds the divergence by requiring propagation before any further promotion proceeds.

Only merge-commit merging SHALL be permitted on `beta` and `main`, enforced by the rulesets' allowed merge methods. Administrator bypass actors SHALL be configured in `pull_request` bypass mode on every long-lived branch ruleset, so an administrator can merge a pull request in exceptional cases but still cannot push directly. The human administrator merges promotion and hotfix pull requests once the required checks report success and the required approval is in place; agents never merge promotion, sync-back, or hotfix pull requests themselves.

#### Scenario: Direct push is rejected on every long-lived branch

- **WHEN** a contributor pushes a commit directly to `dev`, `beta`, or `main`
- **THEN** the push is rejected, and the change must go through a pull request instead

#### Scenario: A long-lived branch cannot be deleted or rewritten

- **WHEN** anyone attempts to delete or force-push `dev`, `beta`, or `main`
- **THEN** the operation is rejected by the ruleset

#### Scenario: Failing application CI blocks a dev pull request

- **WHEN** a pull request targeting `dev` has a failed application CI suite for a scope selected by its diff
- **THEN** that suite's gate context reports failure and the pull request cannot merge

#### Scenario: Unselected scopes never block a dev pull request

- **WHEN** a pull request targeting `dev` does not touch a suite's inputs, so that suite is skipped
- **THEN** that suite's gate context still reports success on the pull request and does not block merging

#### Scenario: A promotion from an unsanctioned source is rejected

- **WHEN** a pull request targeting `beta` or `main` has a head branch that is not the sanctioned upstream (`dev` for `beta`, `beta` for `main`) and not a `hotfix/*` branch
- **THEN** the `promotion integrity` check fails and the pull request cannot merge

#### Scenario: Merging into beta or main requires an approval

- **WHEN** a pull request targeting `beta` or `main` carries no approving review from a reviewer other than its author
- **THEN** the ruleset blocks the merge, whether the pull request is a promotion or a hotfix, and the approving review doubles as the explicit human release decision

#### Scenario: Squash and rebase merges are not offered on beta and main

- **WHEN** a pull request targeting `beta` or `main` is merged
- **THEN** only the merge-commit method is available, making the promotion and sync-back merge-commit discipline structural rather than documented

#### Scenario: An exceptional administrator merge stays pull-request-bound

- **WHEN** an administrator must merge a pull request that does not satisfy the requirements
- **THEN** the administrator bypass applies to the pull request merge only, and a direct push to the branch remains rejected

### Requirement: Hotfix flow

When a defect must be fixed on `beta` or `main` urgently and the normal promotion source carries changes that are not ready to promote, a `hotfix/<name>` branch SHALL be cut from the branch that needs the fix and merged back into that branch through a pull request subject to that branch's entry conditions. The fix SHALL then be propagated downstream — to `dev`, and additionally to `beta` when the hotfix landed on `main` — through merge-commit pull requests, and no new normal promotion SHALL proceed until the propagation is merged, so the defect cannot re-enter through a later promotion or a fresh task branch.

Unlike a promotion, a hotfix's content never passed through `dev`, where review happens, so the approving review that `beta` and `main` require of every pull request matters most for hotfixes; because the author cannot self-approve, a hotfix always carries a second pair of eyes. A change that genuinely cannot wait for a review still has the administrator's `pull_request` bypass; requiring the review is what makes the bypass an exceptional act instead of the routine route.

Downstream propagation SHALL merge the same `hotfix/*` branch into the downstream branches, not the fixed long-lived branch: merging the identical commits keeps histories convergent, and a propagation pull request headed by `main` would fail the `beta` source allowlist, which admits only `dev` and `hotfix/*` heads.

#### Scenario: A beta hotfix while dev is unpromotable

- **WHEN** a defect on `beta` needs an urgent fix and `dev` already carries merged work that must not reach `beta`
- **THEN** a `hotfix/<name>` branch is cut from `beta`, merged back into `beta` under the beta entry conditions, and the fix is propagated to `dev` before the next `dev`-to-`beta` promotion

#### Scenario: A main hotfix propagates to both downstream branches

- **WHEN** a defect affecting production is fixed through a hotfix pull request to `main`
- **THEN** the fix is propagated to `beta` and to `dev` through merge-commit pull requests headed by the same `hotfix/*` branch, before any further promotion proceeds

#### Scenario: A hotfix pull request requires a review

- **WHEN** a pull request from a `hotfix/*` branch targets `beta` or `main`
- **THEN** the ruleset blocks the merge until the pull request carries an approving review from someone other than its author, because the content never passed through `dev` where reviews happen

#### Scenario: Hotfix branches use the same merge-commit discipline

- **WHEN** a hotfix or hotfix-propagation pull request is merged into `beta` or `main`
- **THEN** it uses the merge-commit method, so hotfix commits are real ancestors in every branch that carries them
