# Spec Delta

## MODIFIED Requirements

### Requirement: Promotion integrity gate

Pull requests targeting `beta` or `main` SHALL carry a required `promotion integrity` status check. The check SHALL assert that the pull request's head branch is an allowed source for the target branch, and that the validation owned by the source stage has succeeded on the pull request's head commit: the per-suite application CI gates for any head, and — for a promotion to `main` sourced from `beta` — additionally a successful deployment of the head commit to the beta environment. Deployment evidence is required only from a deployment workflow the batch actually triggered (the deploy workflows are paths-filtered); a batch that triggered none has nothing to deploy and passes without it. A hotfix pull request to `main` MAY proceed without beta-environment deployment evidence, but its head commit MUST have passed the application CI gates.

For a pull request whose base is `beta`, the check SHALL also assert migration release evidence on the promotion diff: every added migration declares its class, the diff deletes or renames no migration file and modifies no migration file present in the base, a `hotfix/*` head adds only `expand` migrations, and every current `contract` satisfies its prerequisite and direct deployment-record evidence. Evidence is scoped to the promotion diff, so a promotion that adds no current contract resolves no deployment evidence. The migration stage SHALL NOT run for a pull request whose base is `main`: the beta deployment already applied those migrations, and the main deploy preflight re-evaluates the same diff before production mutation.

#### Scenario: A dev-to-beta promotion with green suites passes

- **WHEN** a pull request from `dev` to `beta` is opened and the application CI gates report success on its head
- **THEN** the `promotion integrity` check reports success

#### Scenario: A beta-to-main promotion without a successful beta deployment is blocked

- **WHEN** a pull request from `beta` to `main` is opened and the beta-environment deployment of its head commit has failed or has not completed
- **THEN** the `promotion integrity` check fails, because the batch has not been exercised in the beta environment that internal consumers use

#### Scenario: A hotfix to main still requires validated content

- **WHEN** a pull request from a `hotfix/*` branch to `main` is opened
- **THEN** the `promotion integrity` check requires the application CI gates to be green on its head, but does not require beta-environment deployment evidence

#### Scenario: A promotion adds an undeclared migration

- **WHEN** a promotion to `beta` adds a migration file without a complete class declaration
- **THEN** the `promotion integrity` check fails and names the undeclared path

#### Scenario: A promotion deletes, renames, or edits a released migration

- **WHEN** a promotion to `beta` deletes or renames a migration file, or modifies one present in the base
- **THEN** the `promotion integrity` check fails on immutability

#### Scenario: A promotion carries a valid current contract

- **WHEN** the promotion diff adds a contract whose prerequisite pull request and merge commit are valid and whose declared commit has a successful `api-deploy` record for `beta` or `main` with the migration and publication step green
- **THEN** the `promotion integrity` check reports success for the migration release evidence stage

#### Scenario: A current contract's deployment evidence is missing or failed

- **WHEN** a contract in the promotion diff names a commit with no successful `api-deploy` record for `beta` or `main`, or its newest record failed, is still running, or is ambiguous
- **THEN** the `promotion integrity` check fails on the evidence stage and names the human-review path

#### Scenario: A promotion adds no current contract during a deployments outage

- **WHEN** the promotion diff adds no current contract and the deployments API is unavailable
- **THEN** the check does not resolve deployments and is not blocked by that outage

#### Scenario: A hotfix promotion to beta introduces a non-additive migration

- **WHEN** a `hotfix/*` pull request to `beta` adds a `migrate` or `contract` migration
- **THEN** the `promotion integrity` check fails and the change must ship through a normal release

#### Scenario: A beta-to-main promotion is evaluated

- **WHEN** a pull request from `beta` to `main` is opened
- **THEN** the check keeps its suite-gate and beta-deployment contract and reports no separate migration stage; the main deploy preflight evaluates the release diff before production mutation

### Requirement: Hotfix flow

When a defect must be fixed on `beta` or `main` urgently and the normal promotion source carries changes that are not ready to promote, a `hotfix/<name>` branch SHALL be cut from the branch that needs the fix and merged back into that branch through a pull request subject to that branch's entry conditions. The fix SHALL then be propagated downstream — to `dev`, and additionally to `beta` when the hotfix landed on `main` — through merge-commit pull requests, and no new normal promotion SHALL proceed until the propagation is merged, so the defect cannot re-enter through a later promotion or a fresh task branch.

A hotfix pull request MUST add only `expand` migrations. A `migrate` or `contract` declaration MUST ship through a normal release instead, because a hotfix cannot carry the release that its own prerequisite depends on. The rule applies at both release checkpoints: `promotion integrity` for a hotfix targeting `beta`, and the deploy preflight for any hotfix merge that triggers an API deploy.

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

#### Scenario: A hotfix adds an expand migration

- **WHEN** a hotfix release adds only `expand` migrations
- **THEN** the migration release evidence check passes

#### Scenario: A hotfix adds a non-additive migration

- **WHEN** a hotfix pull request adds a `migrate` or `contract` migration
- **THEN** the migration release evidence check fails and the migration must ship through a normal release

#### Scenario: Hotfix branches use the same merge-commit discipline

- **WHEN** a hotfix or hotfix-propagation pull request is merged into `beta` or `main`
- **THEN** it uses the merge-commit method, so hotfix commits are real ancestors in every branch that carries them
