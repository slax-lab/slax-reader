# Proposal

## Status

**Approved on 2026-10-28.** Alex Lee, in the Slax Reader product-owner role, approved the
key-visuals direction on 2026-10-28 and authorized this implementation. The approval covers:

- the trigger — a `UI-visible change`, operationally "the change alters what a user sees on a
  surface" — not the narrower `material UX` classifier;
- volume — 1–3 visual groups, where a before/after pair counts as one group, and more only when
  the change spans independent surfaces, with the
  reason stated;
- the cases — before and after for a surface that already ships, after only for a new surface,
  before only for a removed one, all captured in the same state, theme, and width;
- where a "before" image may come from — the target branch, an earlier capture of the same
  surface, or an accepted demo, naming the source when it is not the target branch;
- a short recording as one group, when a still cannot show the change —
  a transition, drag, or scroll-linked behavior;
- placement and framing — a `## Key visuals` section between Change summary and OpenSpec
  change, captioned so the text stands alone, presenting the evidence that the Test plan
  already carries and neither extending nor replacing it;
- the `n/a` path, restricted so it cannot exempt the transition, drag, or scroll-linked cases
  that require a recording, and no image-presence enforcement in CI;
- replacement, on a later push that changes what a shown group would show.

Conditions recorded with the approval: no verification threshold changes; `DESIGN.md`
(the verification matrix and the acceptance procedure), `REVIEW.md`, `.rulesync/**`, and
`openspec/specs/change-verification/spec.md` stay unedited. Archiving follows the task pull
request, through a docs pull request.

This change carries no delta spec (`skip_specs: true`). It changes how evidence that the
repository already requires is presented in a pull request body, not what is verified, when,
or against which threshold.

## Why

The governance set already obliges a UI-visible change to attach screens across the themes,
responsive widths, and recorded states that `DESIGN.md` requires, and forbids committing that
media to git. What is missing is placement. The template has no slot for a visual summary, so
attachments land inside a long Test plan comment: a reviewer scrolls a wall of text before
meeting the change, and the one recent pull request that attached owner screenshots did so by
improvisation rather than by contract.

Two constraints shape the fix. The automated review evaluates text only, so an image can never
carry the result on its own — the caption is the only channel through which the visual reaches
a text-only reader. And the existing screenshot obligation must not be restated in a weaker
form: a "1–3 screenshots" rule read as *the* evidence set would repeal a normative requirement.

The adopted direction separates presentation from evidence. Key visuals are a small subset
shown at the top of the body; the complete coverage and its attachments stay in the Test plan;
`validation.md` keeps only the text record, because media may not enter the repository. No new
check is added: an image-presence gate would reward attaching *a* file, not the right picture,
and the review cannot see images anyway.

## What Changes

- Add a `## Key visuals` section to `.github/PULL_REQUEST_TEMPLATE.md`, between
  `## Change summary` and `## OpenSpec change`, carrying the trigger, the 1–3 group volume (a
  before/after pair counts as one group) with its multi-surface escape, the
  before/after/new/removed cases and their same-state/theme/width requirement, the caption
  requirement, the recording criterion for motion-only changes as one group, the
  presentation-not-evidence clause, the media pointer, the `n/a` path restricted against the
  motion cases, and replacement on a later push.
- Add one operational bullet to `docs/DEFINITION-OF-DONE.md` § "UI-visible evidence": when a
  UI-visible change carries key visuals, the before/after/after-only/before-only cases, the
  allowed "before" source, the recording criterion, the presentation scope, and replacement in
  the same push. The bullet does not restate the verification matrix or the acceptance
  procedure those sections already own.
- Record the decisions, the rejected alternatives, and the file-ownership boundary in this
  change's `design.md`.

Non-goals:

- Changing what a UI-visible change must verify, the theme/width/state matrix, or the hands-on
  acceptance procedure; the evidence required is exactly what it is today.
- Any image-presence CI, template parser, or review-policy change that would enforce the
  presence of media.
- Editing `DESIGN.md`, `REVIEW.md`, `.rulesync/**` and its generated artifacts,
  `openspec/config.yaml`, or `openspec/specs/change-verification/spec.md`.
- Product UI work, application code, dependencies, deployment, or package version changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. `openspec/specs/change-verification/spec.md` already requires the themed, responsive,
state-complete screens attached as pull request media, and already requires the text record to
stand alone without it. This change neither adds nor relaxes a requirement; it tells an author
where to place a presentation subset of that evidence and what each group must say about
itself. A delta that restated the obligation could only duplicate it, and a delta that imposed
key visuals as a new requirement would change a threshold the approval explicitly left alone.

## Impact

- `.github/PULL_REQUEST_TEMPLATE.md` — the new `## Key visuals` section.
- `docs/DEFINITION-OF-DONE.md` — one bullet in § "UI-visible evidence".
- `openspec/changes/present-key-ux-visuals/` — proposal, design, tasks, validation, and the
  `skip_specs` metadata.

No application code, runtime behavior, API contract, dependency, deployment, or package
version changes: documentation- and tooling-only, which the root version rule exempts from a
version bump inquiry.
