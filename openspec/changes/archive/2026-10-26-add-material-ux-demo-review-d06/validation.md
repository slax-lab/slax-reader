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
7. **Rebase and rebased-tip verification.** After F05 PR #392 merged, the branch was rebased cleanly onto current `origin/dev` (`75c6d274`), producing tip `38c1ca4`; neither the approved semantics nor the implementation text changed. The tower re-ran the full gate on that tip — `pnpm agent:check` (OpenSpec 76/76, rulesync and gh-aw clean), `pnpm test:ci` (67/67), `pnpm design:check` (33 files), and `git diff --check origin/dev...HEAD` — and all passed.
8. **Archive.** After the implementation pull request merged (`74d87c18`), `openspec archive add-material-ux-demo-review-d06 --yes --json` moved this change to `openspec/changes/archive/2026-10-26-add-material-ux-demo-review-d06/` and added the four delta requirements to the living `change-verification` spec. The spawn snapshot's untracked `test-results/` reading copies were dropped per the tower's scope correction before the archive commit.

## Provenance and branch hygiene

- The revised proposal artifacts were imported from `feat/make-material-ux-demo-optional-d20` (commit `250006f1`); a diff of the change directory against that branch showed no differences at import. The approval record, Impact section, and migration plan were then updated for this change.
- The spawn snapshot commit contained only untracked `test-results/material-ux-review/` and `test-results/r08-review/` reading copies. Per the tower's scope correction, the branch was reset to `02f80058` before any mission edit, dropping the snapshot. The main checkout copies were not modified or removed.
- No push and no pull request were performed by the agent. F05 PR #392 is merged in the base as the F05 prerequisite; this change's task pull request and archive remain sequential delivery steps.
- After F05 PR #392 merged, the branch was rebased cleanly onto current `origin/dev` (`75c6d274`). The rebase replayed the D06 rule commit and the implementation commit without conflict or content change, producing tip `38c1ca4`.

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
- `git diff --name-only 02f80058` before the pre-rebase commit listed only the paths in "Diff scope" below.
- On the rebased tip `38c1ca4`, the tower ran and passed: `pnpm agent:check` (OpenSpec `Totals: 76 passed, 0 failed`, rulesync and gh-aw clean), `pnpm test:ci` (67/67), `pnpm design:check` (`Validated 33 design reference files`), and `git diff --check origin/dev...HEAD` (no output). The rebase did not change any implementation or approval text.

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
- The task/status split: import, initial revision, D3 correction, approval (4.1), implementation alignment (5.1–5.5), and archive (7.1) are checked; R08 reconciliation (6.1–6.2) remains an unchecked follow-up owned by the R08 change.

## Diff scope

`git diff --name-only origin/dev...HEAD` on the rebased branch lists exactly:

- `.rulesync/rules/overview.md`
- `AGENTS.md`
- `CLAUDE.md`
- `DESIGN.md`
- `REVIEW.md`
- `openspec/changes/add-material-ux-demo-review-d06/.openspec.yaml`
- `openspec/changes/add-material-ux-demo-review-d06/design.md`
- `openspec/changes/add-material-ux-demo-review-d06/proposal.md`
- `openspec/changes/add-material-ux-demo-review-d06/specs/change-verification/spec.md`
- `openspec/changes/add-material-ux-demo-review-d06/tasks.md`
- `openspec/changes/add-material-ux-demo-review-d06/validation.md`
- `openspec/config.yaml`
- `openspec/specs/change-verification/spec.md`

The net diff no longer names `.github/PULL_REQUEST_TEMPLATE.md`: the D06 commit added the demo item and this branch restored the pre-D06 content, which already matches `origin/dev`. The restoration is still part of the branch's second commit; only the net change against `origin/dev` is empty.

No path under `apps/` or `packages/` appears, no R08 file is touched, and the spawn snapshot's reading copies are not in the branch.

The archive branch's net diff against `origin/dev` (`74d87c18`) contains only the change directory moved under `openspec/changes/archive/2026-10-26-add-material-ux-demo-review-d06/`, the four requirements added to `openspec/specs/change-verification/spec.md`, and this archive record. No R08 path and no other active change directory changes.

## Archive

- `openspec archive add-material-ux-demo-review-d06 --yes --json` → exit 0. `archivedAs: 2026-10-26-add-material-ux-demo-review-d06`, `specsUpdated: true`, totals `added: 4, modified: 0, removed: 0, renamed: 0`.
- Requirements added to `openspec/specs/change-verification/spec.md`: "Material UX changes offer an optional requirements-discovery demo", "An accepted demo is a requirements-discovery step that gates dependent implementation", "An accepted demo is covered and approved as specified", and "The demo checkpoint does not gate review and does not replace hands-on acceptance". Their text and scenarios match the archived delta spec, the living-spec diff deletes or modifies no existing line, and the Purpose already described the optional checkpoint from the implementation, so the archive left it unchanged.
- `openspec validate --all --strict` → `Totals: 75 passed, 0 failed (75 items)`, exit 0. `openspec validate --specs` → `Totals: 58 passed, 0 failed (58 items)`, exit 0. `git diff --check` → no output, exit 0.
- Remaining unchecked tasks are 6.1–6.2 only. They describe the R08 reconciliation that `design.md` § "R08 dependency reconciliation" assigns to `reduce-governance-rules-duplication-r08`'s own follow-up; that change is not present in this worktree and is deliberately not edited, so those tasks stay unchecked here and the archive proceeds with them classified as outside this change's scope. Task 7.1 is completed by this archive.
- The spawn snapshot commit contained only untracked `test-results/material-ux-review/` and `test-results/r08-review/` reading copies. Per the tower's scope correction the branch was reset to the base merge commit `74d87c18` before the archive commit, and those files are not in the branch; the main checkout copies were not modified.

## Local pre-push review (REVIEW.md, three passes)

- **Bugs**: no code or runtime behavior. The artifacts are internally consistent: `DESIGN.md` §10.1, the rules source, the regenerated agent files, `REVIEW.md`, the apply guidance, and the living Purpose describe the same offer/recommend/dependent-wait/feedback-first/opt-out sequence and the same non-blocking review behavior. The scenario mapping above found no gap, and the archived delta is identical to the four requirements the archive added to the living spec.
- **Security**: no secrets, credentials, PII, dependency, network, permission, or file-access change. `pnpm agent:sync` regenerated rules only; no permission file changed.
- **Compliance**: the approval record is present in `proposal.md`; tasks 1.1–5.5 are implemented by the archived diff and this file records the evidence; the archive pass is recorded in § Archive above; R08 (6.1–6.2) remains open by design and owned by the R08 change. This is a documentation/rule change, so the running-environment and hands-on acceptance clauses do not apply and the exemption is stated here. No Important findings.

## Not validated (declared gaps)

- **Review behavior on a future material UX pull request** — whether a reviewer honors the non-blocking rule is observable only after this policy lands. The policy text is checked against the delta spec; its enforcement quality is unverified.
- **Demo offer in a real material UX change** — this diff changes no product UI, so there is no live demo to offer or exercise; the behavior of the offer/recommendation/wait sequence will be observable in the next material UX change that applies it.
- **R08 reconciliation** — tasks 6.1–6.2 are open; R08 is not edited in this change, so its mandatory-gate references remain until its own follow-up in `reduce-governance-rules-duplication-r08`.
- **Archive pull request** — the archive itself is complete and recorded in § Archive; creating, reviewing, and merging the follow-up docs pull request is the delivery step outside this branch.
- **Running environment** — no runtime behavior, product UI, or active rule execution changes in this diff, so no running-environment exercise applies; the Definition of Done documentation-change exemption is stated here.
- **gh-aw advisory output** — the drift check's `i recommend using ecosystem identifiers…` lines are pre-existing informational messages; the compiled-workflow comparison itself passes.
