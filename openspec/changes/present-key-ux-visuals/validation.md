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
| `git diff --check` | clean, no whitespace errors |
| `git diff --name-only` | `.github/PULL_REQUEST_TEMPLATE.md`, `docs/DEFINITION-OF-DONE.md`; the change directory is untracked and added in the same commit |
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
- the guidance states every approved rule (trigger, volume with its independent-surface escape,
  three surface cases, pairing and the caption's surface/state/theme/width/change content, the
  recording counting inside the 1–3, presentation scope, media pointer, `n/a` path,
  replacement).

All assertions report `ok` on the delivered state. Two rounds of failures were harness artefacts,
not content: the first check sliced the Definition of Done by blank-line-separated blocks and so
captured the whole bullet list instead of the single bullet, and the second matched phrases
against wrapped line ends. The extraction was corrected to the bullet's own line range and the
comparison normalizes whitespace; the bullet's content then passed every assertion.

## Case coverage

Each approved case, where it is stated, and a one-line body example the section accepts:

| Case | Template clause | Definition of Done clause | Body example |
| --- | --- | --- | --- |
| Surface that already ships | "a surface that already ships gets before and after" | "before and after for a surface that already ships" | Settings page, dark theme, 390px — before: default card; after: card with the new border |
| New surface | "a new surface after only" | "after only for a new surface" | Reader toolbar, light theme, 768px — after only: toolbar with four controls |
| Removed surface | "a removed surface before only" | "before only for a removed one" | Legacy share sheet, light theme, 1024px — before only: the sheet with the removed row |
| Motion-only change | "transition, drag, or scroll-linked behavior … gets a short recording … caption names what to watch" | "a short recording whose caption names what to watch" | Recording: opening the comment drawer, light, 390px — watch the 180ms slide and the backdrop fade |
| Later push changes a shown visual | "replaces it here" | "replaces that visual in the same push" | Replaced the after visual after the caption font changed; the earlier attachment is superseded |
| No visible surface, or a still cannot usefully show it | 'write "n/a" with the reason' | covered by the template section the bullet points to | n/a — this pull request changes only test fixtures; no surface renders differently |

The pairing rule (same state, theme, and width, captioned with the surface, state, theme, width,
and what changed), the volume escape (more than 1–3 only when the change spans independent
surfaces, with the reason stated), and the allowed "before" sources (target branch, an earlier
capture of the same surface, accepted demo, naming the source when it is not the target branch)
are stated in both files.

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

## Media

This change attaches no screenshots or recordings: it defines the rule, and the media it
governs is produced by later UI-visible pull requests, uploaded with `gh --attach` and never
committed. The text above stands alone without media, as the rule it introduces requires.

## Declared gaps

- **First real render.** The section's rendering and the caption-as-only-channel practice can
  only be exercised by the next UI-visible pull request. That pull request must confirm the
  images render and the captions stand alone before it merges, and it must replace any visual a
  later push invalidates. No throwaway draft pull request was opened to exercise it earlier:
  opening one is an external action outside this change's authority.
- **Visual currency.** The rule cannot verify that an author attached the right image, only
  that the caption names what the image should show. That check stays a review duty by design
  (`design.md` D8).
- **Version bumps.** None are due: documentation-only, with no shipped behavior or package
  output affected, which the root version rule exempts.

## Delivery state

The branch `feat/present-key-ux-visuals` is rebased onto the current `origin/dev` tip as part of
delivery, so the delivered commit sits directly on top of `origin/dev`; it is delivered as
pull request #426 against `dev`. The change directory carries no delta specs (`skip_specs`), so
archiving moves no requirement into `openspec/specs/`; the archive step is the unchecked task in
`tasks.md` and happens through a docs pull request after the task pull request merges.
