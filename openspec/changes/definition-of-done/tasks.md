# Tasks

## 1. Agent rules (rulesync sources)

- [x] 1.1 Add a "Definition of Done" section to `.rulesync/rules/overview.md`: behavior changes are exercised in a running environment before a pull request opens (agent-driven where possible, declared gaps acceptable, silence not); verification recorded in `openspec/changes/<change-id>/validation.md` and summarized in the PR Test plan; PR bodies follow `.github/PULL_REQUEST_TEMPLATE.md`; media uploads via `gh --attach` (gh v2.99.0+), never committed; the text record stands alone; for UI-visible changes the evidence satisfies `DESIGN.md`'s verification matrix (themes, responsive widths, recorded states) and the human exercises the change hands-on in the agent-prepared running environment before the pull request opens (adjustment loop closes first; acceptance recorded in `validation.md`; no declared-gap path for this step); links to `docs/web/development.md`, `docs/extension/development.md`, `docs/api/DEVELOPMENT-DOCUMENT-EN.md`, `docs/cli/DEVELOPMENT.md` for per-app check commands. Verify: the section exists in the source file and covers every clause of spec requirement "Behavior changes are exercised in a running environment before review", "Verification evidence is recorded and travels with the change", and "Media evidence stays out of git history".
- [x] 1.2 Add the review-feedback loop rule to the "Code Review" section of `.rulesync/rules/overview.md` (poll review comments, resolve or answer every Important finding, push to re-trigger, `/review` fallback, IM reminders are a fallback). Verify: the clauses match spec requirement "Author agents close the review-feedback loop".
- [x] 1.3 Add the evidence binding to `.rulesync/rules/mobile-architecture.md`: native acceptance results are recorded in `validation.md` like any other verification. Verify: the mobile native-acceptance clause now names the evidence record.
- [x] 1.4 Run `pnpm agent:sync` and commit the rulesync sources and regenerated files in the same commit. Verify: `pnpm exec rulesync doctor --strict && pnpm exec rulesync generate --check` exits zero, and `grep -n "Definition of Done" AGENTS.md apps/mobile/AGENTS.md` finds the new section in the generated outputs.

## 2. Review policy and pull request template

- [x] 2.1 Add step 5 to the Compliance pass in `REVIEW.md`: template/Test-plan presence, empty evidence trail, and evidence contradicting observable facts are Important Compliance findings; a declared "not verified, because" gap is not a finding. Verify: the step matches spec requirement "Review policy enforces the evidence contract" and adds no operational documentation (per `REVIEW.md`'s own scope rule).
- [x] 2.2 Upgrade `.github/PULL_REQUEST_TEMPLATE.md`: Test plan comment becomes an explicit evidence requirement (commands run, scenarios exercised, what was not verified and why, link to `validation.md`, media attached not committed; documentation/typo-scale changes may write `n/a` with the reason, refactors state diff-derived smoke verification); checklist updated accordingly. Verify: the rendered template shows the new Test plan guidance and consistent checklist items.

## 3. OpenSpec apply-loop guidance

- [x] 3.1 Add a line to `operations.apply.guidance` in `openspec/config.yaml`: before suggesting a pull request, record verification in `openspec/changes/<change-id>/validation.md` and summarize it in the PR Test plan (see the Definition of Done in `AGENTS.md`). Verify: `pnpm exec openspec instructions apply --change definition-of-done --json` output contains the new guidance, and `pnpm exec openspec validate --all --strict` passes.

## 4. CI: OpenSpec skill drift check

- [x] 4.1 Drill the check locally: in a clean worktree run the pinned regeneration (`pnpm exec openspec update`, non-interactive) and `git status --porcelain` over the OpenSpec-generated paths; confirm no diff on a clean tree and a detected diff after deliberately editing one skill file. Verify: both outcomes recorded (they become evidence for this change's own `validation.md`), including the exact non-interactive invocation and the generated path list.
- [x] 4.2 Add the drift check to `.github/workflows/agent-config.yml` following the gh-aw check's pattern, wired into the `openspec` ci-scope flag (and `full_validation`). Verify: the workflow file passes the repo's gh-aw drift check (`bash tooling/check-gh-aw-drift.sh` / `gh aw compile --strict --purge --no-check-update` shows no drift) and `openspec validate --all --strict` still passes.

## 5. Dogfood, validate, and ship

- [x] 5.1 Write this change's own `openspec/changes/definition-of-done/validation.md` following the new contract: commands run and results, what was exercised, and what was NOT verified (for example: the new CI drift check verified locally, not in a live CI run; the review agent's evidence-check behavior observable only after merge). Verify: the file exists and satisfies every clause a reviewer would check under the new `REVIEW.md` step 5.
- [ ] 5.2 Run the local pre-push review from `REVIEW.md` (all three passes), resolve Important findings, and open the pull request whose body follows the upgraded template with `OpenSpec: definition-of-done`. Verify: the review reports no Important findings and the PR body carries the evidence summary linking `validation.md`.
- [ ] 5.3 [HUMAN] After merge: announce the Definition of Done and the one-time `gh` v2.99.0+ upgrade to the team. Verify: announcement sent in the team's IM channel.
