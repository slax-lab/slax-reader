# Validation

## Scope and classification

Documentation- and tooling-only change: `docs/DEFINITION-OF-DONE.md` and
`.github/PULL_REQUEST_TEMPLATE.md`, plus this change directory. No application code, runtime
behavior, API contract, dependency, or shipped asset changes, so the documentation exemption in
`docs/DEFINITION-OF-DONE.md` § "When this applies" covers it and the change states that
exemption here. No surface renders differently, so no UI hands-on acceptance applies; the
acceptance procedure targets UI-visible changes, and this change adds no UI.

Verification is therefore the governance check the change itself requires: structural validity,
the diff, and a case-by-case check that the new section and the Definition of Done bullet state
every approved rule and nothing they must not restate.

## Commands and results

Run in `/Users/boxcounter/Code/Slax/slax-reader/.tower/worktrees/wt-40` on
`feat/present-key-ux-visuals`, after the edits and a rebase onto current `origin/dev`.

| Command | Result |
| --- | --- |
| `pnpm exec openspec validate present-key-ux-visuals --strict` | `Change 'present-key-ux-visuals' is valid`, with the info line that `skip_specs` is set and zero deltas are accepted |
| `pnpm exec openspec validate --all --strict` | `Totals: 79 passed, 0 failed (79 items)` before the rebase; `Totals: 82 passed, 0 failed (82 items)` after the rebase onto current `origin/dev`, which added two changes |
| `git diff --check origin/dev...HEAD` | clean, no whitespace errors |
| `git diff --name-only origin/dev...HEAD` | `.github/PULL_REQUEST_TEMPLATE.md`, `docs/DEFINITION-OF-DONE.md`, and `openspec/changes/present-key-ux-visuals/` (`.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `validation.md`) |
| `git rev-parse HEAD` against `gh pr view 426 --json headRefOid` | equal — pull request #426's head is the delivered branch head |
| `grep -rn "PULL_REQUEST_TEMPLATE" .github tooling openspec apps packages` | no code, workflow, or tooling path reads the template; the only non-archive hit is the governance requirement in `openspec/specs/agent-rule-governance/spec.md` naming it as a policy text |

## Template structure and rendering check

No Markdown engine is installed in the worktree, so rendering was checked structurally instead
of through a renderer. GitHub hides HTML comments in a pull request body, so what determines the
rendered result is the comment structure and the visible headings; the check asserted exactly
that:

- the `<!--` and `-->` markers balance, and no comment is left open to swallow the rest of the
  body;
- the visible heading order, after removing comments, is `## Change summary` → `## Key visuals` →
  `## OpenSpec change` → `## Linked issue` → `## Test plan` → `## Checklist`;
- the Key visuals guidance sits inside a single HTML comment that does not appear in the visible
  text, and it sits between the Key visuals heading and the OpenSpec change heading;
- the guidance states every approved rule (trigger, the 1–3 group volume with a before/after
  pair as one group and the independent-surface escape, three surface cases, pairing and the
  caption's surface/state/theme/width/change content, the recording as one group, presentation
  scope, media pointer, the `n/a` path restricted against the motion cases, replacement).

All assertions report `ok` on the delivered state. Two rounds of failures were harness artefacts,
not content: the first check sliced the Definition of Done by blank-line-separated blocks and so
captured the whole bullet list instead of the single bullet, and the second matched phrases
against wrapped line ends. The extraction was corrected to the bullet's own line range and the
comparison normalizes whitespace; the bullet's content then passed every assertion.

## Case coverage

Each approved case, where it is stated, and a one-line body example the section accepts:

| Case | Groups | Template clause | Definition of Done clause | Body example |
| --- | --- | --- | --- | --- |
| Surface that already ships | 1 | "a surface that already ships gets a before/after pair as one group" | "a before/after pair for a surface that already ships counts as one group" | Settings page, dark theme, 390px — before: default card; after: card with the new border |
| New surface | 1 | "a new surface gets after only" | "a new surface gets after only" | Reader toolbar, light theme, 768px — after only: toolbar with four controls |
| Removed surface | 1 | "a removed surface before only" | "a removed one before only" | Legacy share sheet, light theme, 1024px — before only: the sheet with the removed row |
| Motion-only change | 1 | "a motion-only change … gets a short recording as its group, and its caption names what to watch" | "carries a short recording as its group, whose caption names what to watch" | Recording: opening the comment drawer, light, 390px — watch the 180ms slide and the backdrop fade |
| Later push changes a shown group | n/a | "replaces that group here" | "replaces that group in the same push" | Replaced the after group after the caption font changed; the earlier attachment is superseded |
| No visible surface, or a still cannot usefully show a non-motion change | n/a | 'write "n/a" with the reason only for a change with no visible surface, or for a visible change a still cannot usefully show that is outside the motion cases above' | covered by the template section the bullet points to | n/a — this pull request changes only test fixtures; no surface renders differently |

The group unit (a before/after pair is one group, a recording is one group, so three before/after
pairs fit the 1–3 cap), the pairing rule (same state, theme, and width, captioned with the
surface, state, theme, width, and what changed), and the independent-surface escape (more than
1–3 groups only when the change spans independent surfaces, with the reason stated) are stated
in both operative files. Before-image provenance is owned by `docs/DEFINITION-OF-DONE.md` only:
the target branch, an earlier capture of the same surface, or the accepted demo, naming the
source when it is not the target branch. The `n/a` path is restricted in the template so a
transition, drag, or scroll-linked change cannot use it.

## What the edits intentionally do not do

- Restate the verification matrix: the template says only "the complete state/theme/width
  evidence stays in the Test plan"; the Definition of Done bullet does not mention the matrix,
  themes, or widths beyond the pairing requirement.
- Restate the acceptance procedure: neither file names §10.2, and the Definition of Done's
  acceptance bullet is unchanged.
- Enforce image presence: no CI workflow, script, or template parser was added; the search
  above confirms nothing reads the template. Section presence remains text-detectable, which is
  the accepted consequence recorded in `design.md` D8.
- Change any other rule: `DESIGN.md`, `REVIEW.md`, `.rulesync/**` and its generated artifacts,
  `openspec/config.yaml`, and `openspec/specs/change-verification/spec.md` are absent from the
  diff, and the `agent-rule-governance` requirement that those texts agree on exemption scope
  and no-proposal smoke inputs still holds because neither topic changed.
- Duplicate another active change: no active change under `openspec/changes/` references
  `.github/PULL_REQUEST_TEMPLATE.md`; the only references are in archived changes.

## Review round 1 correction

Independent review round 1 (`reviewer-present-ux-visuals`, reviewed tip `e8e8b9a9`) returned
`p1-2items` / fix-then-merge on two wording divergences from the approved rule. Both were fixed
in the operative texts, with no redesign:

1. **The unit is a visual group.** The template said "1–3 visuals" and the Definition of Done
   repeated "1–3 key visuals", so a before/after pair would have consumed two of three slots.
   Both files now define "1–3 visual groups", state that a before/after pair is one group, and
   use that unit in the motion clause (a recording is its group) and the independent-surface
   clause ("more groups only when …"). `design.md` D2/D3/D5 and `proposal.md` state the same
   unit, and D2 records why counting images would shrink the effective volume.
2. **The `n/a` escape no longer reaches the motion cases.** The template previously allowed
   `n/a` for "a visible change a still cannot usefully show", which could exempt exactly the
   transition, drag, or scroll-linked changes that require a recording. The escape is now
   limited to "a change with no visible surface, or … a visible change a still cannot usefully
   show that is outside the motion cases above". `design.md` D3/D5 state the restriction, and
   the Definition of Done bullet names the recording as a group without any escape.

Re-run after the correction: `openspec validate --all --strict` → `Totals: 82 passed, 0 failed
(82 items)`; `openspec validate present-key-ux-visuals --strict` → valid with the `skip_specs`
info line; `git diff --check` clean; the structure and case checks re-run with the new clauses,
including assertions for the group unit and the narrowed `n/a` path, all `ok`.

## Media

This change attaches no screenshots or recordings: it defines the rule, and the media it
governs is produced by later UI-visible pull requests, uploaded with `gh --attach` and never
committed. The text above stands alone without media, as the rule it introduces requires.

## Declared gaps

- **First real render.** The section's rendering and the caption-as-only-channel practice can
  only be exercised by the next UI-visible pull request. That pull request must confirm the
  images render and the captions stand alone before it merges, and it must replace any group a
  later push invalidates. No throwaway draft pull request was opened to exercise it earlier:
  opening one is an external action outside this change's authority.
- **Visual currency.** The rule cannot verify that an author attached the right image, only
  that the caption names what the image should show. That check stays a review duty by design
  (`design.md` D8).
- **Version bumps.** None are due: documentation-only, with no shipped behavior or package
  output affected, which the root version rule exempts.

## Delivery state

Pull request #426, `docs(governance): present key UX visuals in the pull request template`,
merged into `dev` as merge commit `263b9cd0` on 2026-10-28. The commands table above records the
checks as they were run before that merge: it is the evidence observed at delivery time, not a
live gate, so nothing here depends on the branch or the pull request head staying put. The
delivered diff covers the operative files and the change directory listed in that table. The
change directory carries no delta specs (`skip_specs`), so archiving merged no requirement into
`openspec/specs/`; § Archive below records the archive action and its results.

## Archive

The precondition the archive task names is met: pull request #426 is merged into `dev` at
`263b9cd0`. Classification before archiving: the only unchecked item was task 5, the archive
follow-up itself, which by definition this branch performs. It was completed with the evidence
its Verify clause asks for, in `tasks.md`, rather than dropped or archived around, and no other
task was unchecked — `grep -c '^- \[ \]'` over `tasks.md` returned `0`, so the archive ran
without the tool's incomplete-task prompt.

Run in `/Users/boxcounter/Code/Slax/slax-reader/.tower/worktrees/wt-44` on
`feat/archive-present-key-ux-visuals`, rebased onto the `dev` tip that contains `263b9cd0`.

| Command | Result |
| --- | --- |
| `pnpm exec openspec archive present-key-ux-visuals --yes --skip-specs --json` | exit 0; `archivedAs: "2026-10-28-present-key-ux-visuals"`, `specsUpdated: false` |
| `pnpm exec openspec validate --all --strict` | `Totals: 82 passed, 0 failed (82 items)` — 62 specs and 20 active changes — exit 0 |
| `pnpm exec openspec validate --archived` (tree-wide lint) | `change/2026-10-28-present-key-ux-visuals` passes; the tree-wide run reports `Totals: 64 passed, 11 failed (75 items)`, exit 1, entirely from archives that predate this change (see the last note below) |
| `git diff --cached --check` | no output, exit 0 |
| `git diff --cached -M --name-status` | the five files move from `openspec/changes/present-key-ux-visuals/` to `openspec/changes/archive/2026-10-28-present-key-ux-visuals/`; no other path |

What the move preserved and what it changed:

- `.openspec.yaml` travels with the change and keeps all three keys — `schema: spec-driven`,
  `created: 2026-10-28`, `skip_specs: true`.
- `specsUpdated: false` with an unchanged `openspec/specs/` tree: `skip_specs: true` and no
  `specs/` directory leave nothing to merge, so no living requirement changed and no capability
  was retired. `--skip-specs` was passed explicitly, so the flag decided it rather than the
  absent directory.
- The content inside the moved directory changed in exactly two files: `tasks.md` task 5,
  completed with its evidence, and this file, whose § Delivery state is restated as merged facts
  and whose § Archive is new. `proposal.md`, `design.md`, and `.openspec.yaml` are byte-identical
  to their delivered content at `263b9cd0`.
- `present-key-ux-visuals` no longer appears in the active change tree, which is why
  `openspec validate present-key-ux-visuals --strict` now answers `Unknown item`. That is the
  expected result of the move, not a lost record; the archived copy is covered by
  `openspec validate --archived`.

Pre-existing condition outside this change: `openspec validate --archived` reports 11 archived
changes with incomplete tasks, for example `2026-10-26-add-material-ux-demo-review-d06` at 15/17
completed. `lefthook.yml` and the `agent-config` workflow enforce only
`openspec validate --all --strict`, which passes, so this diff neither causes nor is blocked by
that state. Bringing those historical archives to a completed-task state is a separate backlog
item that this archive does not touch.
