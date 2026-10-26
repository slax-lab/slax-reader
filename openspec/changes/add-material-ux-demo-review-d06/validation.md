# Validation — add-material-ux-demo-review-d06

Date: 2026-10-26

Change type: process and policy (agent rules, design contract, review policy, pull request template, OpenSpec apply guidance, capability spec). No application runtime behavior and no product UI changed, so there is no demo to produce and no UI hands-on acceptance to record — the running environment exercised here is the repository's agent toolchain itself. The material-UX demo gate this change defines applies to future changes, not to this documentation change.

## Commands run

- `pnpm install --frozen-lockfile` in the worktree → `Done in 20.6s using pnpm v11.25.0`. A fresh worktree has no `node_modules`; this also installed the lefthook hooks through the root `prepare` script.
- `pnpm agent:sync` → regenerated `AGENTS.md` and `CLAUDE.md` from the edited `.rulesync/rules/overview.md`. `git status --short` shows no change under `.claude/`, `.codex/`, `.agents/`, or `apps/mobile/AGENTS.md`.
- `pnpm agent:check` → exit 0. Its parts: `rulesync doctor --strict` reported `No problems found (0 error(s), 0 warning(s), 0 info(s))`; `rulesync generate --check` reported `All files are up to date`; `openspec validate --all --strict` reported `76 passed, 0 failed`; `bash tooling/check-gh-aw-drift.sh` reported `Compiled workflows match their sources.`
- `pnpm exec openspec validate --all --strict` → `Totals: 76 passed, 0 failed (76 items)`, exit 0.
- `pnpm exec openspec instructions apply --change add-material-ux-demo-review-d06 --json` → `state: ready`, 13 tasks, and `operationGuidance` contains the new material-UX line.
- `pnpm design:check` → `Validated 33 design reference files`, exit 0 (the `DESIGN.md` edits leave the reference snapshot valid).
- `git diff --check` → no output, exit 0.

## Rule text checked against every delta-spec scenario

The implementation is policy text, so the exercise is a line-by-line check that each WHEN/THEN scenario is satisfied by a reader-facing rule.

| Scenario | Where it is satisfied |
| --- | --- |
| Material UX implementation waits for demo approval | `DESIGN.md:280` (trigger list), `DESIGN.md:289` (approval before UI implementation), `.rulesync/rules/overview.md:65`, generated `AGENTS.md:68` / `CLAUDE.md:68` |
| Demo covers the material surface | `DESIGN.md:291-296` (main flow, key states, themes, responsive widths, inapplicable dimensions named) |
| Non-material UI change is exempt | `DESIGN.md:300`, `.rulesync/rules/overview.md:68` |
| Approval record is complete | `DESIGN.md:298` (approver and role, date, scope, coverage, conditions, authorization), `.rulesync/rules/overview.md:67` |
| Record survives a temporary demo | `DESIGN.md:298` ("write the record to stand alone"), `.rulesync/rules/overview.md:67` |
| Conditional approval is carried into implementation | `DESIGN.md:298` (conditions recorded; a structural adjustment returns to the human), delta spec |
| Missing approval record blocks the merge | `REVIEW.md:57-58` (Important Compliance finding; "unreviewed design, not an exemption") |
| Incomplete approval record is a finding | `REVIEW.md:58` ("or one that omits any of those elements") |
| Approval does not replace hands-on acceptance | `REVIEW.md:61`, `DESIGN.md:304-306` (§10.2), `.rulesync/rules/overview.md:69,88` |
| Review scope for pre-policy work | `REVIEW.md:59` (material UX implemented before the policy is judged under step 5; later material UX scope is in scope) |

## What was exercised

- The rulesync regeneration path end to end: source edit → `pnpm agent:sync` → `generate --check` → the rule appears in both generated root files and in no unintended output.
- The OpenSpec apply loop for this change: `openspec instructions apply` surfaces the new guidance before implementation, which is the point where an agent would otherwise start coding.
- Strict spec validation across the whole tree, including the edited living spec Purpose and the new delta.
- The review policy as a reviewer would read it: step 6 catches a missing record and an incomplete record, verifies the record rather than the demo, and keeps step 5's acceptance independent.
- The staged diff contains no product code (recorded below).

## Diff scope

- `git add -A && git diff --cached --stat` → 14 files: `.github/PULL_REQUEST_TEMPLATE.md`, `.rulesync/rules/overview.md`, `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `REVIEW.md`, `openspec/changes/add-material-ux-demo-review-d06/**` (`.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `validation.md`, `specs/change-verification/spec.md`), `openspec/config.yaml`, and `openspec/specs/change-verification/spec.md`.
- No path under `apps/` or `packages/` appears; the generated files are `AGENTS.md` and `CLAUDE.md` only, both from `.rulesync/rules/overview.md`.
- After the commit, `git diff --stat origin/dev...HEAD` lists the same 14 paths, so the committed range matches what was reviewed here.

## Local pre-push review (REVIEW.md, three passes)

- **Bugs**: no logic or regression risk — the diff is documentation and policy text. Cross-references checked: `DESIGN.md` §10.1/§10.2, `REVIEW.md` step 6, `.rulesync` rule, generated `AGENTS.md`/`CLAUDE.md`, `openspec/config.yaml`, and the pull request template all name the same triggers, coverage, record fields, and exemptions. One gap found and fixed during this review: `REVIEW.md` step 6 initially had no boundary for material UX implemented before the policy existed; added the scope bullet at `REVIEW.md:59`.
- **Security**: no secrets, credentials, or PII introduced; no dependency, network, or file-access change. Approval records name a human approver, which matches existing proposal practice and public commit metadata.
- **Compliance**: local change-id determined from `openspec/changes/` — several changes are active, but only this change carries a `change-verification` delta and its proposal matches the diff, so the change-id is `add-material-ux-demo-review-d06`. Tasks 1.1–3.3 are implemented in the diff; the validation-evidence trail is this file; the diff changes no `apps/**` or `packages/**` path, so the UI hands-on-acceptance clause is exempt with this reason. No Important findings.

## Not validated (declared gaps)

- The review gate's behavior on a future material UX pull request — whether the automated review actually reports an Important finding for a missing record — is observable only after merge, on a real change. The policy text was checked against the delta spec; its enforcement quality is unverified.
- No demo was produced, because this change has no UI. The demo gate is verified as rule text, not exercised through a live material UX change.
- The authenticity of an approval record cannot be machine-verified. The rule requires the record; a fabricated record is a trust failure outside automated enforcement (recorded in `design.md` as a residual risk).
- The grandfathering boundary in `REVIEW.md:59` depends on reviewer judgment about when material UI was implemented; no automated check exists.
