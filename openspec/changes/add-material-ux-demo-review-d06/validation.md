# Validation — add-material-ux-demo-review-d06

Date: 2026-10-26

Change type: proposal revision plus its approved implementation alignment (documentation, agent rules, and review policy). No product UI, token, application code, runtime behavior, API contract, dependency, deployment, or package-version change. This change itself is not a material UX change — it defines the policy for future UI work — so no demo or hands-on UI acceptance applies to this diff; that exemption is stated here.

## Revision history

1. **Import.** The six change-directory files were imported verbatim from `feat/add-material-ux-demo-review-d06` (implementation commit `02f80058`) without that branch's implementation edits.
2. **Optional checkpoint.** The mandatory demo gate was replaced with an optional, user-selected checkpoint; missing demo or approval records became explicitly non-blocking.
3. **D3 correction — requirements discovery.** The demo is defined as a requirements-discovery tool, not visual sign-off. When the human opts in, all implementation whose requirements or design depends on the unresolved UX decisions waits — UI, backend behavior, data models, API contracts, and test expectations — and only demonstrably independent work proceeds. Feedback updates the requirements before implementation, and the recommendation trigger covers requirement uncertainty as well as high rework risk.
4. **Opt-out note removed.** A decline leaves no record and is not re-asked; the conversation is the decision record. Only an accepted demo records feedback and the resulting requirements/approval.
5. **Approval.** Alex Lee approved the revised direction on 2026-10-26 in the Slax Reader product-owner role; the record and the approved semantics are in `proposal.md` § Status. Conditions recorded with the approval: the superseded mandatory-gate implementation is amended rather than delivered as-is; `reduce-governance-rules-duplication-r08` is reconciled in its own follow-up; archiving follows the task pull request.
6. **Implementation alignment.** The superseded mandatory-gate implementation was amended: `DESIGN.md` (§1 reading order, §10 workflow, §10.1 optional requirements-discovery checkpoint, §10.2 independent acceptance, §11 checklist); `.rulesync/rules/overview.md` and the regenerated `AGENTS.md`/`CLAUDE.md`; `REVIEW.md` (mandatory approval step removed, absent demo/record added to the non-reporting scope, hands-on acceptance check kept); `.github/PULL_REQUEST_TEMPLATE.md` (restored to its pre-D06 content); `openspec/config.yaml` (apply guidance); and the living `change-verification` Purpose. R08 and archive remain follow-ups.

## Provenance and branch hygiene

- The revised proposal artifacts were imported from `feat/make-material-ux-demo-optional-d20` (commit `250006f1`); a diff of the change directory against that branch showed no differences at import. The approval record, Impact section, and migration plan were then updated for this change.
- The spawn snapshot commit contained only untracked `test-results/material-ux-review/` and `test-results/r08-review/` reading copies. Per the tower's scope correction, the branch was reset to `02f80058` before any mission edit, dropping the snapshot. The main checkout copies were not modified or removed.
- No push and no pull request were performed. The F05 task pull request and this change's task pull request and archive remain sequential delivery steps.

## Commands run

- `pnpm agent:check` → exit 0. `rulesync doctor --strict` and `rulesync generate --check` pass; `openspec validate --all --strict` reports `Totals: 76 passed, 0 failed (76 items)`; the gh-aw drift check reports `Compiled workflows match their sources.`
- `pnpm exec openspec validate add-material-ux-demo-review-d06 --strict` → `Change 'add-material-ux-demo-review-d06' is valid`, exit 0.
- `pnpm exec openspec validate --all --strict` → `Totals: 76 passed, 0 failed (76 items)`, exit 0.
- `pnpm test:ci` → 67 tests, 67 pass, 0 fail.
- `pnpm design:check` → `Validated 33 design reference files`, exit 0.
- `git diff --check` → no output, exit 0.
- `pnpm exec openspec instructions apply --change add-material-ux-demo-review-d06 --json` → `operationGuidance` carries the offer/recommend/dependent-wait/feedback-first/no-repeat text and names `DESIGN.md` section 10.1.
- Wording sweep over `DESIGN.md`, `REVIEW.md`, `.rulesync/rules/overview.md`, `AGENTS.md`, `CLAUDE.md`, `openspec/config.yaml`, and the living spec: no remaining sentence makes a demo or approval mandatory, pauses only UI, or reports a missing demo/record as Important. The remaining `Important Compliance finding` hits are the verification-evidence and UI hands-on acceptance checks, which must stay.
- Link and path exercise: the local Markdown link in the changed files resolves. 60 referenced repository paths were checked; all exist except pre-existing references not introduced here — `deploy/local/api.toml`, `deploy/local/.env`, `deploy/local/.dev.vars` (gitignored operator files) and the illustrative `apps/api/prisma/migrations/` example in `REVIEW.md`.
- `git diff --name-only 02f80058` before the commit lists only the paths in "Diff scope" below.

## Delta-spec scenarios traced to the amended text

| Scenario | Where it is satisfied |
| --- | --- |
| Material UX change offers the demo | `DESIGN.md` §10.1 offer paragraph; `.rulesync/rules/overview.md` material-UX section; `AGENTS.md`/`CLAUDE.md` (generated); `openspec/config.yaml` apply guidance |
| Requirement uncertainty carries a recommendation | `DESIGN.md` §10.1 recommendation bullets; rules section; apply guidance |
| High-rework-risk change carries a recommendation | `DESIGN.md` §10.1 recommendation bullets; rules section; apply guidance |
| Human declines the demo | `DESIGN.md` §10.1 decline paragraph; rules bullet on decline; `REVIEW.md` "Do not report" entry; apply guidance |
| Non-material UI change is exempt | `DESIGN.md` §10.1 exempt paragraph; rules exemption bullet |
| Dependent implementation waits for the demo feedback | `DESIGN.md` §10.1 accepted-demo bullets; rules acceptance bullet |
| Independent work proceeds | `DESIGN.md` §10.1 accepted-demo bullets (demonstrably-independent allowance); rules acceptance bullet |
| Demo feedback updates the requirements first | `DESIGN.md` §10.1 feedback bullet; rules feedback bullet |
| Scope-changing feedback repeats the demo | `DESIGN.md` §10.1 feedback bullet; rules feedback bullet |
| Offer is unanswered | `DESIGN.md` §10.1 accepted-demo bullets ("While the offer is unanswered…") |
| Accepted demo covers the material surface | `DESIGN.md` §10.1 coverage list |
| Opt-in approval record is complete | `DESIGN.md` §10.1 record paragraph; rules record bullet |
| Record survives a temporary demo | `DESIGN.md` §10.1 record paragraph ("Write the record to stand alone"); rules record bullet |
| Conditional approval is carried into implementation | `DESIGN.md` §10.1 record and feedback paragraphs; rules record and feedback bullets |
| Missing demo record does not block | `REVIEW.md` "Do not report" entry; `DESIGN.md` §10.1 final paragraph; rules non-blocking bullet |
| Approval does not replace hands-on acceptance | `DESIGN.md` §10.2; `REVIEW.md` step 5 UI-visible acceptance bullet and "Do not report" entry; rules non-blocking bullet; `change-verification` Purpose |

## What was exercised

- The regenerated artifacts: `pnpm agent:sync` wrote `AGENTS.md` and `CLAUDE.md` only; both contain the new material-UX section and the Definition of Done bullet, and the old missing-record-as-Important sentence is absent.
- The template restore: `.github/PULL_REQUEST_TEMPLATE.md` is byte-identical to its content at `02f80058^`, so no checklist item or Test plan guidance demands a demo.
- The apply guidance: the generated instruction payload returns the new text, confirming `openspec/config.yaml` is parsed and consumed.
- The review policy: `REVIEW.md` no longer contains the mandatory approval step; the absent demo/record is listed under "Do not report"; the UI-visible hands-on acceptance check remains in the evidence trail.
- The living spec Purpose: describes the optional requirements-discovery checkpoint and the done contract without claiming a mandatory pre-implementation gate.
- The scenario mapping above, checked line by line against the amended rule text.
- The task/status split: import, initial revision, D3 correction, approval (4.1), and implementation alignment (5.1–5.5) are checked; R08 reconciliation (6.1–6.2) and archive (7.1) remain unchecked follow-ups.

## Diff scope

`git diff --name-only 02f80058` lists exactly:

- `.github/PULL_REQUEST_TEMPLATE.md`
- `.rulesync/rules/overview.md`
- `AGENTS.md`
- `CLAUDE.md`
- `DESIGN.md`
- `REVIEW.md`
- `openspec/changes/add-material-ux-demo-review-d06/design.md`
- `openspec/changes/add-material-ux-demo-review-d06/proposal.md`
- `openspec/changes/add-material-ux-demo-review-d06/specs/change-verification/spec.md`
- `openspec/changes/add-material-ux-demo-review-d06/tasks.md`
- `openspec/changes/add-material-ux-demo-review-d06/validation.md`
- `openspec/config.yaml`
- `openspec/specs/change-verification/spec.md`

No path under `apps/` or `packages/` appears, no R08 file is touched, and the spawn snapshot's reading copies are not in the branch.

## Local pre-push review (REVIEW.md, three passes)

- **Bugs**: no code or runtime behavior. The artifacts are internally consistent: `DESIGN.md` §10.1, the rules source, the regenerated agent files, `REVIEW.md`, the apply guidance, and the living Purpose describe the same offer/recommend/dependent-wait/feedback-first/opt-out sequence and the same non-blocking review behavior. The scenario mapping above found no gap.
- **Security**: no secrets, credentials, PII, dependency, network, permission, or file-access change. `pnpm agent:sync` regenerated rules only; no permission file changed.
- **Compliance**: the approval record is present in `proposal.md`; tasks 1.1–5.5 are implemented by this diff and this file records the evidence; R08 (6.1–6.2) and archive (7.1) stay open by design. This is a documentation/rule change, so the running-environment and hands-on acceptance clauses do not apply and the exemption is stated here. No Important findings.

## Not validated (declared gaps)

- **Review behavior on a future material UX pull request** — whether a reviewer honors the non-blocking rule is observable only after this policy lands. The policy text is checked against the delta spec; its enforcement quality is unverified.
- **Demo offer in a real material UX change** — this diff changes no product UI, so there is no live demo to offer or exercise; the behavior of the offer/recommendation/wait sequence will be observable in the next material UX change that applies it.
- **R08 reconciliation** — tasks 6.1–6.2 are open; R08 is not edited in this change, so its mandatory-gate references remain until its own follow-up.
- **Archive** — task 7.1 is open; archiving follows this change's task pull request.
- **Running environment** — no runtime behavior, product UI, or active rule execution changes in this diff, so no running-environment exercise applies; the Definition of Done documentation-change exemption is stated here.
- **gh-aw advisory output** — the drift check's `i recommend using ecosystem identifiers…` lines are pre-existing informational messages; the compiled-workflow comparison itself passes.
