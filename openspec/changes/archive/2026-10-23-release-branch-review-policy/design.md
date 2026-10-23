# Design

## Context

See proposal.md — Why. Current state after `branch-protection-model` landed:

- `release-beta` and `release-main` rulesets carry a `pull_request` rule with `required_approving_review_count: 0`; every other pull-request parameter is already at its disabled default.
- `tooling/promotion-gate.mjs` asserts the hotfix review itself: `reviewApprovers` (line ~283) folds review states per reviewer, `reviewEvidence` (~298) throws `ReviewApprovalRequired` when no non-author approval exists, `runPromotionGate` (~339) calls it for hotfix heads, and the top-level catch (~417) special-cases that error with "re-run this workflow after the approval lands" guidance. Tests cover the same behavior.
- The gate cannot observe an approval without a re-run, which is why the failure text teaches the re-run dance; the `pull_request_review` trigger that would have automated it was rejected on security grounds (a non-`target` variant would run the head's workflow file).
- `REVIEW.md`'s compliance pass demands an `OpenSpec:` line and a Test plan evidence trail from every behavior-changing pull request, with no exemption for promotion or sync-back pull requests; the first real promotion (`#355`) collected false-positive compliance findings for exactly that reason.

## Goals / Non-Goals

**Goals:**

- Make the hotfix review requirement structural (ruleset-enforced) instead of script-asserted.
- Delete the re-run-after-approval dance from both code and documentation.
- Stop false-positive compliance findings on promotion and sync-back pull requests.

**Non-Goals:**

- Changing `dev`'s review requirements (one approval with code-owner review stays).
- Changing what the `promotion integrity` gate asserts beyond the review removal (source allowlist, CI gates, beta deployment evidence all stay).
- Building batch-level content review; the approval on a promotion is the human release decision, not a re-review of the batch.

## Decisions

### D1: One approving review on every `beta`/`main` pull request, set uniformly in the rulesets

Set `required_approving_review_count: 1` in the `release-beta` and `release-main` pull_request rules; leave all other parameters untouched (`dismiss_stale_reviews_on_push: false`, no code-owner requirement, no last-push approval). GitHub never counts the author's self-approval, so the hotfix "non-author review" semantics come for free.

Alternatives considered:

- *Keep the gate-side assertion.* Rejected: it needs a manual re-run after approval and a security-sensitive trigger to automate, both of which disappear under the ruleset.
- *Mirror `dev`'s stricter settings (dismiss stale, last-push approval).* Rejected: a promotion pull request's head branch keeps advancing as its source branch advances; dismiss-on-push would discard approvals on every unrelated push to the source and force re-approval loops. Batch gating is already provided by the CI gates and the promotion integrity evidence, so the extra strictness buys nothing here.
- *Require code-owner review on `beta`/`main`.* Rejected: the batch's content was code-owner-reviewed when each change entered `dev`; repeating it per promotion adds delay, not signal.

Trade-off accepted: promotions now wait for one human approval. That is intentional — it is the explicit release decision — and the repository has more than one active administrator who can give it.

### D2: Remove the review assertion from the promotion gate

Delete `ReviewApprovalRequired`, `reviewApprovers`, `reviewEvidence`, the hotfix call site in `runPromotionGate`, the special-cased guidance in the top-level catch (the generic "re-run this workflow after the required approval lands" wording also loses its reason to exist and is simplified), and the corresponding tests. The hotfix path keeps its remaining difference: skipping beta-deployment evidence while still requiring green application CI gates.

### D3: Exempt promotion and sync-back pull requests in `REVIEW.md`, not in the spec

The `agentic-pr-review` spec already defers "which pull requests count as behavior-changing" and the compliance pass's contents to `REVIEW.md`. The exemption therefore belongs in the policy file alone: a new compliance-pass clause stating that promotion pull requests (head `dev` → base `beta`, head `beta` → base `main`) and sync-back pull requests are exempt from the `OpenSpec:` line and Test plan evidence-trail requirements, because their content was reviewed in the constituent task pull requests and the batch has no single change-id — and that body references to in-flight evidence on such pull requests are not contradictions. The exemption names the pull request shape (head/base pair), not the branch naming, so a `hotfix/*` pull request is NOT exempt: hotfix content never passed a `dev` review.

### D4: Documentation follows the code

`.rulesync/rules/overview.md` and `docs/CI.md` currently describe the gate-asserted hotfix review and the re-run guidance; both are rewritten for ruleset-enforced review, and the generated agent files are refreshed with `pnpm agent:sync` in the same commit.

## Risks / Trade-offs

- [Approvals on promotions add latency to every release] → Accepted deliberately (D1); bypass remains for genuine emergencies via the administrator's `pull_request` bypass mode.
- [Ruleset apply is a remote mutation] → Unchanged from the existing arrangement: `rulesets.mjs apply` is a human-invoked, explicitly authorized local operation, confirmed by the drift check afterwards.
- [An exemption keyed on head/base pairs could be abused by naming a task branch `dev`] → Branch names `dev`/`beta`/`main` are the long-lived branches themselves; no task branch can collide, and `hotfix/*` is explicitly not exempt.

## Migration Plan

1. Land the code, policy, and documentation changes through one pull request to `dev`.
2. After merge, a human with admin credentials runs `node tooling/rulesets.mjs apply` to raise the review requirement on the live rulesets, then `node tooling/rulesets.mjs check` to confirm zero drift.
3. Between the pull request merging and step 2 running, the live rulesets are weaker than the codified ones; the scheduled drift check will flag exactly that if the apply is forgotten.

## Open Questions

(none)
