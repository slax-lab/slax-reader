# Spec Delta

## ADDED Requirements

### Requirement: Per-branch protection contracts

Each long-lived branch SHALL have a protection contract — its state guarantee, allowed write paths, and entry conditions — and the branch rulesets SHALL enforce that contract. All three branches SHALL reject direct pushes, deletion, and non-fast-forward updates. The contracts differ because the branches gate different decisions:

- `dev` gates individual-change quality. Merging a pull request to `dev` SHALL require the `agent-config drift check` and `PR review gate` contexts, the per-suite application CI gate contexts, and one approving review including a code-owner review. Each application CI gate SHALL report exactly one status context with a stable, suite-unique name on every pull request; when a suite's scope is not selected by the pull request's diff, its gate SHALL report success (skipped scopes never block). All merge methods remain available on `dev`.
- `beta` gates batch release-readiness. Changes SHALL arrive only through pull requests whose head branch is `dev` or a `hotfix/*` branch. Merging SHALL require the `promotion integrity` context and the per-suite application CI gate contexts, so the assembled batch is validated as a whole at entry. No approving review is required for promotions: the content was reviewed when it entered `dev`, and the merge itself is the designed release-decision act. Hotfix heads fall outside that rationale; see the Hotfix flow requirement.
- `main` gates provenance. Changes SHALL arrive only through pull requests whose head branch is `beta` or a `hotfix/*` branch, and merging SHALL require the `promotion integrity` context carrying the stage evidence for that source: for a `beta` head, the head commit MUST have been deployed successfully to the beta environment by every deployment workflow the batch triggered (the deploy workflows are paths-filtered, so a batch that triggered none requires no deployment evidence); for a `hotfix/*` head, the head commit MUST have passed the application CI gates. Content validation is not repeated on `main`, so a tree arriving from `beta` is identical to the tree the `beta` stage validated. A `hotfix/*` head is the only sanctioned divergence from that identity — it carries content `beta` never validated — and the Hotfix flow requirement bounds the divergence by requiring propagation before any further promotion proceeds.

Only merge-commit merging SHALL be permitted on `beta` and `main`, enforced by the rulesets' allowed merge methods. Administrator bypass actors SHALL be configured in `pull_request` bypass mode on every long-lived branch ruleset, so an administrator can merge a pull request in exceptional cases but still cannot push directly. The human administrator merges promotion and hotfix pull requests once the required checks report success; agents never merge promotion, sync-back, or hotfix pull requests themselves.

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

#### Scenario: Squash and rebase merges are not offered on beta and main

- **WHEN** a pull request targeting `beta` or `main` is merged
- **THEN** only the merge-commit method is available, making the promotion and sync-back merge-commit discipline structural rather than documented

#### Scenario: An exceptional administrator merge stays pull-request-bound

- **WHEN** an administrator must merge a pull request that does not satisfy the requirements
- **THEN** the administrator bypass applies to the pull request merge only, and a direct push to the branch remains rejected

### Requirement: Promotion integrity gate

Pull requests targeting `beta` or `main` SHALL carry a required `promotion integrity` status check. The check SHALL assert that the pull request's head branch is an allowed source for the target branch, and that the validation owned by the source stage has succeeded on the pull request's head commit: the per-suite application CI gates for any head, and — for a promotion to `main` sourced from `beta` — additionally a successful deployment of the head commit to the beta environment. Deployment evidence is required only from a deployment workflow the batch actually triggered (the deploy workflows are paths-filtered); a batch that triggered none has nothing to deploy and passes without it. A hotfix pull request to `main` MAY proceed without beta-environment deployment evidence, but its head commit MUST have passed the application CI gates.

#### Scenario: A dev-to-beta promotion with green suites passes

- **WHEN** a pull request from `dev` to `beta` is opened and the application CI gates report success on its head
- **THEN** the `promotion integrity` check reports success

#### Scenario: A beta-to-main promotion without a successful beta deployment is blocked

- **WHEN** a pull request from `beta` to `main` is opened and the beta-environment deployment of its head commit has failed or has not completed
- **THEN** the `promotion integrity` check fails, because the batch has not been exercised in the beta environment that internal consumers use

#### Scenario: A hotfix to main still requires validated content

- **WHEN** a pull request from a `hotfix/*` branch to `main` is opened
- **THEN** the `promotion integrity` check requires the application CI gates to be green on its head, but does not require beta-environment deployment evidence

### Requirement: Hotfix flow

When a defect must be fixed on `beta` or `main` urgently and the normal promotion source carries changes that are not ready to promote, a `hotfix/<name>` branch SHALL be cut from the branch that needs the fix and merged back into that branch through a pull request subject to that branch's entry conditions. The fix SHALL then be propagated downstream — to `dev`, and additionally to `beta` when the hotfix landed on `main` — through merge-commit pull requests, and no new normal promotion SHALL proceed until the propagation is merged, so the defect cannot re-enter through a later promotion or a fresh task branch.

Unlike a promotion, a hotfix's content never passed through `dev`, where review happens, so a hotfix pull request SHALL require one approving review from an approver other than its author, asserted by the `promotion integrity` check rather than by the ruleset, because rulesets cannot condition on the head branch. A change that genuinely cannot wait for a review still has the administrator's `pull_request` bypass; requiring the review is what makes the bypass an exceptional act instead of the routine route.

Downstream propagation SHALL merge the same `hotfix/*` branch into the downstream branches, not the fixed long-lived branch: merging the identical commits keeps histories convergent, and a propagation pull request headed by `main` would fail the `beta` source allowlist, which admits only `dev` and `hotfix/*` heads.

#### Scenario: A beta hotfix while dev is unpromotable

- **WHEN** a defect on `beta` needs an urgent fix and `dev` already carries merged work that must not reach `beta`
- **THEN** a `hotfix/<name>` branch is cut from `beta`, merged back into `beta` under the beta entry conditions, and the fix is propagated to `dev` before the next `dev`-to-`beta` promotion

#### Scenario: A main hotfix propagates to both downstream branches

- **WHEN** a defect affecting production is fixed through a hotfix pull request to `main`
- **THEN** the fix is propagated to `beta` and to `dev` through merge-commit pull requests headed by the same `hotfix/*` branch, before any further promotion proceeds

#### Scenario: A hotfix pull request requires a review

- **WHEN** a pull request from a `hotfix/*` branch targets `beta` or `main`
- **THEN** the `promotion integrity` check fails unless the pull request carries an approving review from someone other than its author, because the content never passed through `dev` where reviews happen

#### Scenario: Hotfix branches use the same merge-commit discipline

- **WHEN** a hotfix or hotfix-propagation pull request is merged into `beta` or `main`
- **THEN** it uses the merge-commit method, so hotfix commits are real ancestors in every branch that carries them

### Requirement: Ruleset state codification and drift detection

The expected ruleset state for the long-lived branches SHALL be codified as version-controlled JSON in the repository, normalized so that server-assigned identifiers and timestamps do not produce false drift. A scheduled workflow SHALL compare the live repository rulesets against the codified state and open a GitHub issue when they differ; the comparison SHALL NOT gate pull requests. An intentional protection change SHALL update the codified JSON and apply the live rulesets as part of the same change. Applying ruleset mutations SHALL be a human-invoked, explicitly authorized local operation, never an unattended CI action.

#### Scenario: Manual ruleset edits surface as an issue

- **WHEN** the live ruleset configuration is changed outside the codified state
- **THEN** the scheduled comparison opens a GitHub issue describing the drift within one schedule period

#### Scenario: An intentional change leaves no drift

- **WHEN** a change updates the codified JSON and applies the same state to the live rulesets
- **THEN** the next scheduled comparison reports no drift

#### Scenario: Drift detection never blocks work

- **WHEN** the scheduled comparison detects drift or fails to run
- **THEN** no pull request is blocked, because the comparison is not a required status check on any branch

## MODIFIED Requirements

### Requirement: Promotion flow between release lines

Feature work SHALL flow `feature branch → dev → beta → main`: task branches fork from `dev` and merge back into `dev`; promotion to the next environment happens only through pull requests from `dev` to `beta` and from `beta` to `main`, subject to the target branch's protection contract. Urgent fixes MAY reach `beta` or `main` outside this source order only through the hotfix flow. Each task SHALL use its own branch and pull request, and parallel tasks MUST NOT carry delta specs for the same capability.

#### Scenario: A task branch starts from dev

- **WHEN** a contributor or agent starts a new task
- **THEN** its branch is cut from `origin/dev`, and the resulting pull request targets `dev`

#### Scenario: Promotion uses pull requests between long-lived branches

- **WHEN** changes on `dev` are ready for beta, or changes on `beta` are ready for production
- **THEN** a pull request from `dev` to `beta` (or `beta` to `main`) carries them, gated by the target branch's entry conditions

### Requirement: Promotion pull requests merge with a merge commit

Promotion pull requests (`dev` → `beta` and `beta` → `main`) MUST be merged with the merge-commit method and MUST NOT be rebase- or squash-merged. Rebase and squash both forge new commits for patches the source branch already carries, leaving source and target with different SHAs for identical content; GitHub's mergeable gate evaluates a trial merge, and once histories have diverged that gate blocks every merge method until a sync-back merge re-converges them. A merge commit makes the target branch contain the source branch's actual commits, so histories converge and subsequent promotions stay mergeable. On `beta` and `main` the rulesets SHALL permit only merge-commit merging, making this discipline structural; `dev` keeps all merge methods available, so task pull requests keep their merge-style freedom and sync-back pull requests targeting `dev` can still use merge commits.

#### Scenario: Target branch lands the reviewed commits

- **WHEN** a promotion pull request is merged with a merge commit
- **THEN** the target branch's history contains the exact commits that were reviewed on the source branch, and the source branch tip becomes an ancestor of the target branch

#### Scenario: Diverged histories need a sync-back first

- **WHEN** a promotion pull request reports conflicts because an earlier rebase or squash forged duplicate SHAs for the same patches
- **THEN** the target branch is merged back into the source branch first (resolving in favor of the source branch's content), and only then is the promotion merged

#### Scenario: Merge-method restriction is enforced by the ruleset

- **WHEN** anyone merges a pull request targeting `beta` or `main`
- **THEN** the ruleset offers only the merge-commit method, so neither squash nor rebase can forge duplicate SHAs on the release lines

## REMOVED Requirements

### Requirement: Uniform protection on all long-lived branches

**Reason**: The three branches gate different decisions — individual-change quality on `dev`, batch release-readiness on `beta`, provenance on `main` — so uniform protection both re-ran per-change checks where they added no signal and failed to provide the batch and provenance guarantees the release lines actually need. In practice the uniform ruleset was narrowed to `dev`, leaving `beta` and `main` with no protection at all, and nothing detected the drift.

**Migration**: Superseded by the "Per-branch protection contracts", "Promotion integrity gate", and "Ruleset state codification and drift detection" requirements. The existing `release-branches` ruleset keeps covering `dev` and gains the application CI gates as required contexts; new rulesets are created for `beta` and `main`. The documented administrator-merge path for promotions is preserved through `pull_request`-mode bypass actors and the removal of the unobtainable approving-review requirement on promotions.
