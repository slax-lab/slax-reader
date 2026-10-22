# Mark pull requests ready for human review with a label

## Why

The Feishu bridge (`slax-lab/slax-notify-bridge`) announces a human review on GitHub's review-request event. Because the release-branches ruleset requires code-owner review, GitHub requests the CODEOWNERS reviewers the instant a pull request is opened — six to ten minutes before `PR Review` and `PR review gate` finish. The group is called to a pull request that cannot be reviewed yet, and sometimes to one the automated review is about to reject (2026-10-19, #278: announcement at 08:51, AI review submitted at 09:01 with Important findings).

The gate already computes the only authoritative verdict, "no automated blocker". This change exposes that verdict as an explicit pull-request state — the `ready-for-human-review` label — so the notification bridge can announce the human review when it can actually start, instead of inferring readiness from a creation-time event.

## What Changes

- `pr-review-gate.yml` maintains the label: a passing status for the pull request's current head adds it, a failing one removes it; the label only describes a pull request that can enter human review, so a draft, a closed pull request, or one whose head lives in a fork never carries it. Results about a superseded commit never change it.
- A new `ready-for-review-label.yml` removes the label whenever the verified state no longer applies: a new head, reopen, draft conversion, ready-for-review transition, or close. Its failures are ignored by design: a missing label is the normal path.
- `docs/CI.md` documents the label contract, including that it does not change merge requirements.
- The label name is a cross-repository contract with the bridge's per-repository notification policy (implemented in the same change set, separate repository).

## Non-goals

- Do not change the gate's merge semantics, ruleset, required checks, or review behaviour. The label neither blocks nor authorises a merge; the `PR review gate` status remains the only automated gate.
- Do not automate draft → ready transitions. Draft remains the author's "not finished" signal; this label describes what the automated pipeline verified, not what the author intends.
- Do not create a review queue, dashboard, or automation that consumes the label beyond the notification bridge.
- Do not change CI scope selection, pause handling, or the watchdog.
- Do not make the label a required check or a merge requirement.

## Capabilities

### Modified Capabilities

- `agentic-pr-review`: **ADDED** `The merge gate declares readiness for human review` — the label's add/remove rules, the current-head constraint, the companion removal workflow, and the explicit statement that the label does not affect mergeability.

## Impact

- Workflows: `.github/workflows/pr-review-gate.yml` (grant `issues: write`, maintain the label), new `.github/workflows/ready-for-review-label.yml`.
- Docs: `docs/CI.md`.
- Spec: `openspec/specs/agentic-pr-review/spec.md` via this change.
- No application code, package versions, secrets, or ruleset changes.
- Cross-repository: the bridge change `ready-label-review-announcement` consumes the label event.
