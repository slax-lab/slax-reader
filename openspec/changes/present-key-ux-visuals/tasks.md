# Tasks

## 1. Proposal and approval record

- [x] 1.1 Create `openspec/changes/present-key-ux-visuals/` with `schema`, `created`, and
  `skip_specs: true`, and no `specs/` directory, because this change alters evidence
  presentation rather than a verification threshold. Verify: `openspec validate
  present-key-ux-visuals --strict` reports the change valid and notes the `skip_specs`
  declaration — done; the single-change validation reports "Change 'present-key-ux-visuals' is
  valid" with the `skip_specs` info line, and `specs/` does not exist.
- [x] 1.2 Write `proposal.md` recording Alex Lee's 2026-10-28 approval (product-owner role) and
  its conditions — trigger, 1–3 volume with the independent-surface escape, the
  before/after, after-only, and before-only cases, before provenance, motion recordings,
  placement and framing, the `n/a` path, no image-presence enforcement, later-push
  replacement, and the untouched-threshold condition — plus Why, What Changes, Non-goals,
  Capabilities, and Impact. Verify: the status section names who and when and lists every
  approved rule; the Capabilities section says None for new and modified with the reason —
  present, and the reason cites the existing normative screenshot and media requirements.

## 2. Record the section in the pull request template

- [x] 2.1 Insert `## Key visuals` between `## Change summary` and `## OpenSpec change`, with the
  guidance carried as one HTML comment: the trigger, the 1–3 group volume with a before/after
  pair counted as one group and the independent-surface escape, the three surface cases, the
  same-state/theme/width pairing, the caption naming surface, state, theme, width, and what
  changed, the motion recording as one group, the presentation-not-evidence clause, the
  `gh --attach` and no-commit pointer with text standing alone, the `n/a` path with its reason
  restricted so it cannot exempt the motion cases, and replacement on a later push. Verify: the
  visible heading order is Change summary → Key visuals → OpenSpec change → Linked issue → Test
  plan → Checklist; the guidance stays inside the comment and does not render as body text; the
  comment markers balance — done; the structural check reports every assertion `ok`.

## 3. Record the procedure in the Definition of Done

- [x] 3.1 Add one bullet to `docs/DEFINITION-OF-DONE.md` § "UI-visible evidence" covering the
  group unit (a before/after pair counts as one group), the cases, the pairing, the allowed
  "before" sources with the naming rule, the motion criterion as one group, the presentation
  scope, and replacement in the same push. Verify: the bullet restates neither the verification
  matrix nor the acceptance procedure, and both neighbouring bullets are unchanged — done; the
  isolated bullet check reports no matrix, acceptance, or theme-coverage restatement, and the
  diff leaves the matrix, acceptance, and ownership bullets intact.

## 4. Verification

- [x] 4.1 Run the strict OpenSpec validation tree-wide and for this change. Verify: the
  tree-wide run reports `Totals: 79 passed, 0 failed (79 items)` on the branch base and
  `Totals: 82 passed, 0 failed (82 items)` after the rebase onto current `origin/dev`, and the
  single-change run reports the change valid — both observed after the edits.
- [x] 4.2 Run the diff checks. Verify: `git diff --check` is clean and the changed paths are
  exactly `.github/PULL_REQUEST_TEMPLATE.md`, `docs/DEFINITION-OF-DONE.md`, and
  `openspec/changes/present-key-ux-visuals/` — observed.
- [x] 4.3 Exercise the approved cases against the section and the Definition of Done bullet:
  existing surface before/after, new surface after-only, removed surface before-only, motion
  recording, later-push replacement, and the `n/a` path. Verify: each case has a matching
  clause in both files and a one-line body example the section accepts — done; the case script
  reports `ok` for all six.
- [x] 4.4 Confirm the untouched boundary: `DESIGN.md`, `REVIEW.md`, `.rulesync/**` and its
  generated artifacts, `openspec/specs/change-verification/spec.md`, and
  `openspec/config.yaml` do not appear in the diff, and no image-presence check, template
  parser, or CI workflow was added. Verify: the diff name list and a search for template
  consumers confirm it — done.

## 5. Archive

- [ ] After this change's pull request merges, archive `present-key-ux-visuals` through a docs
  pull request.
