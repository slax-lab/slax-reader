# Validation

## Commands run

- `node --test tooling/promotion-gate.test.mjs` — 28/28 pass, including the rewritten hotfix case (`a hotfix to main skips deploy evidence and never reads reviews`, which registers no reviews route so any attempt to call it throws inside the test router).
- `node --test tooling/` — 233/237 pass. The 2 failures (`tooling/env-files.test.mjs` "parser supports comments…" and `tooling/preflight.test.mjs` "parseEnvText reads export syntax…") reproduce identically on a clean `origin/dev` checkout (31 pass / 2 fail for those two files), so they are pre-existing baseline breakage, not caused by this change.
- `node tooling/rulesets.mjs check` — reports exactly the intended diff and nothing else: `required_approving_review_count` expected 1, live 0, on `release-beta` and `release-main`.
- `pnpm openspec validate release-branch-review-policy --strict` — valid. The single INFO (archive would refuse the MODIFIED delta because `Per-branch protection contracts` does not exist yet on this branch's main spec) is the recorded sequencing dependency on the `branch-protection-model` archive PR.
- `pnpm agent:sync` — regenerated `AGENTS.md`/`CLAUDE.md` committed with the `.rulesync` source in the same commit; `git status` clean afterwards.

## Pre-push review (REVIEW.md, three passes)

- Compliance: change-id is `release-branch-review-policy`; the diff implements its proposal/design/tasks 1.1–3.2 as written. The `REVIEW.md` edit adds an exemption, which is the human-approved purpose of this change, not a policy weakening smuggled into a diff.
- Bugs: removed review code has no remaining callers (`reviewApprovers`/`reviewEvidence`/`ReviewApprovalRequired`/`PR_AUTHOR` grep-clean outside the archived change record); `allowedHead` still returns the hotfix boolean its own tests assert; workflow permissions and env vars match the workflow test's expectations.
- Security: the change only removes a permission (`pull-requests: read`) and an env var; no new dependencies, network calls, or secret handling.

## Not verified here

- Live ruleset mutation: `rulesets.mjs apply` is task 4.3, a human-authorized post-merge operation; until it runs, the drift check intentionally reports the pending diff.
- End-to-end behavior of the gate on a real promotion/hotfix pull request after the ruleset change; first real exercise happens on the next `dev` → `beta` promotion.
- The 2 pre-existing tooling test failures above are out of scope for this change and reported to the human separately.
