# Design

## Context

Three documents touch a UI-visible change's evidence today, and each owns a different layer:
`openspec/specs/change-verification/spec.md` owns the normative requirement (screens across
the themes, responsive widths, and recorded states that `DESIGN.md` requires, attached as pull
request media; media never committed; the text record stands alone); `DESIGN.md` §6 owns the
matrix and §10.2 the hands-on acceptance; `docs/DEFINITION-OF-DONE.md` owns the operational
evidence procedure. `.github/PULL_REQUEST_TEMPLATE.md` owns the form every pull request body
follows. The template has five sections and no visual slot, so media is mentioned only inside
the Test plan comment and attachments end up inside it — a reviewer reads the evidence trail
before meeting the change.

The boundary this design holds: key visuals are **presentation of evidence that already
exists**. They are placed early so a reviewer meets the change first, and they are a subset so
the body stays readable. They never become the evidence set, and no check counts them.

## D1 — Trigger: `UI-visible change` with an operational test, not `material UX`

**Decision.** The rule applies to a `UI-visible change`, defined operationally as "the change
alters what a user sees on a surface". Volume is then governed by the 1–3 cap rather than by a
severity adjective.

**Alternatives rejected.** `material UX` is `DESIGN.md` §10.1's structural classifier for the
optional requirements-discovery demo — information architecture, navigation model, multi-step
flow, core interaction, primary-action placement, whole-screen layout. A whole-surface restyle
inside an unchanged structure is not material UX and would therefore get no visuals, the exact
opposite of the intent. The human's phrase "obvious UX change" has no definition in the repo;
two authors would disagree about it, and it would drag `DESIGN.md` into a presentation rule.

## D2 — Volume: 1–3 groups, with a stated escape for independent surfaces

**Decision.** 1–3 visual groups by default, where a before/after pair is **one group** and a
recording is one group. A change spanning independent surfaces may exceed the cap only when the
body states why. This mirrors how the repository handles dimensions that do not apply
(`DESIGN.md` requires naming an inapplicable state, theme, or width with its reason rather than
omitting it silently).

**Alternatives rejected.** A hard cap would force an arbitrary choice on a cross-surface
change. No cap invites a wall of images, which defeats the reason the section exists. Counting
individual images rather than groups would spend two of the three slots on one before/after
pair, leaving a multi-surface change unable to show its second surface at the approved volume.

## D3 — Cases, pairing, and the `n/a` path

| Change | Visuals | Groups |
| --- | --- | --- |
| Surface that already ships | before and after | 1 |
| New surface | after only | 1 |
| Removed surface | before only | 1 |
| Motion-only (transition, drag, scroll-linked behavior a still cannot show) | a short recording | 1 |

A before/after pair must share the state, theme, and width, and the caption must name the
surface, state, theme, width, and what changed — a mismatched pair misleads more than no pair.
Crop to the changed surface so the block stays short. `n/a` with its reason covers a change
with no visible surface, and a visible change a still cannot usefully show *outside* the motion
cases; it must never exempt a transition, drag, or scroll-linked change, which requires the
recording.

## D4 — Where a "before" image may come from

**Decision.** The target branch, an earlier capture of the same surface, or the accepted demo —
naming the source when it is not the target branch.

**Alternative rejected.** Requiring a rebuild of the target branch for every "before". On
Mobile and native surfaces that is expensive enough that the rule would be skipped, and a
skipped rule invites a fabricated "before". Naming the source keeps the reviewer's ability to
judge currency and costs the author one clause.

## D5 — Motion: recording instead of stills

**Decision.** A transition, drag, or scroll-linked behavior that a still cannot show gets a
short recording; its caption names what to watch, and the caption states the expected motion in
one line so the text record stands alone. The recording is one group, not an addition to the
1–3, and the `n/a` path may not be used for it.

**Alternatives rejected.** Requiring a recording for every change (cost, and stills are better
for static surfaces). Leaving motion changes without any visual (the reviewer cannot judge the
interaction at all).

## D6 — Presentation, not evidence

**Decision.** The complete state/theme/width coverage and its attachments stay in the Test
plan; `validation.md` holds only the text record. The template clause says the groups "present
it and neither extend nor replace it".

**Alternatives rejected.** Moving full coverage into `validation.md` is impossible: media may
not enter the repository, so `validation.md` can never hold the images. Letting key visuals
stand in for full coverage would repeal the existing normative scenario that requires screens
across the themes, widths, and states — a threshold change the approval excludes.

## D7 — Update on a later push

**Decision.** Scope the obligation to a push that changes what a shown group shows; that push
replaces the affected group in place. GitHub attachments are immutable, so "replace" means
editing the body and re-attaching.

**Alternative rejected.** Appending a second set leaves the reviewer unable to tell which is
current. Orphaned attachment links from the replaced image are harmless.

## D8 — No image-presence enforcement

**Decision.** No CI check, script, or template parser inspects whether a visual exists.

**Reasons.** The review evaluates text only, so an image check would reward attaching *a* file
rather than the right picture. A parser would couple a documentation file to tooling for no
gain — nothing parses the template today.

**Consequence accepted.** Section membership is text-detectable, so a body missing
`## Key visuals` can draw a Compliance finding under the existing "every template section
present" rule. That is section presence, not image presence. The `n/a` path exists so every
documentation and tooling pull request can satisfy it in one line.

**Alternative rejected.** Exempting the section in `REVIEW.md`'s "Do not report" list would
make the section decorative and would edit the review policy, which the approval excludes.

## D9 — Ownership: two files, and no delta spec

| Layer | File | Change |
| --- | --- | --- |
| Normative spec | `openspec/specs/change-verification/spec.md` | None — already requires the media and the standalone text |
| Operational | `docs/DEFINITION-OF-DONE.md` § "UI-visible evidence" | One bullet: cases, before provenance, motion criterion, presentation scope, replacement |
| Machine contract | `.github/PULL_REQUEST_TEMPLATE.md` | The section: position, volume, pairing, caption, `n/a`, media pointer |
| Design contract | `DESIGN.md` | None — owns acceptance and the matrix, not body presentation |
| Review policy | `REVIEW.md` | None |
| Agent entry | `.rulesync/**` and generated agents | None — the existing pointer to `docs/DEFINITION-OF-DONE.md` already covers it |
| Apply guidance | `openspec/config.yaml` | None — "summarize it in the pull request's Test plan" stays true because visuals are not evidence |

`docs/DEFINITION-OF-DONE.md`'s intake rule — "a new verification threshold enters the normative
spec first" — is satisfied because no threshold changes: the set of evidence is exactly what it
is today, and key visuals only present it. Its outflow rule — "a UI procedure moves to
`DESIGN.md` §10" — does not apply either: this prescribes where evidence is shown in a pull
request body, not a UI technique, design standard, or acceptance step.

## D10 — A zero-delta proposal, not `OpenSpec: n/a`

**Decision.** Deliver this as a change directory with `skip_specs: true` and no delta specs.
`@fission-ai/openspec` 1.13.1 honors the marker, and `openspec validate --all --strict` must
pass as part of the verification.

**Alternatives rejected.** `OpenSpec: n/a` is allowed for documentation changes, but this one
alters what every future contributor produces; a proposal gives the reviewer the intent, the
rejected alternatives, and a validation record. A `change-verification` delta was rejected
because there is nothing normative to change — restating the existing screenshot requirement
would duplicate it, and adding key visuals as a requirement would create a threshold.

## Drafted wording

`.github/PULL_REQUEST_TEMPLATE.md`, between `## Change summary` and `## OpenSpec change`:

```markdown
## Key visuals

<!-- 1–3 visual groups for a change that alters what a user sees, so a reviewer meets the change before the evidence trail: a surface that already ships gets a before/after pair as one group, a new surface gets after only, and a removed surface before only, all in the same state, theme, and width and captioned with the surface, state, theme, width, and what changed. A motion-only change — transition, drag, or scroll-linked behavior a still cannot show — gets a short recording as its group, and its caption names what to watch. More groups only when the change spans independent surfaces, with the reason stated. The complete state/theme/width evidence stays in the Test plan; these groups present it and neither extend nor replace it. Attach with `gh --attach` and never commit media; the captions must stand alone without the images. Write "n/a" with the reason only for a change with no visible surface, or for a visible change a still cannot usefully show that is outside the motion cases above. A later push that changes what a group shows replaces that group here. -->
```

`docs/DEFINITION-OF-DONE.md` § "UI-visible evidence", after the matrix bullet:

```markdown
- The pull request carries 1–3 key visual groups near its change summary, following the
  template's Key visuals section: a before/after pair for a surface that already ships counts as
  one group, a new surface gets after only, and a removed one before only, captured in the same
  state, theme, and width and captioned with the surface, state, theme, width, and what changed;
  a motion-only change (a transition, drag, or scroll-linked behavior a still cannot show)
  carries a short recording as its group, whose caption names what to watch. More than 1–3 groups
  only when the change spans independent surfaces, with the reason stated. A before image may
  come from the target branch, an earlier capture of the same surface, or the accepted demo,
  naming its source when it is not the target branch. The groups present the evidence above
  without extending or replacing it, and a later push that changes what a group shows replaces
  that group in the same push.
```

## Risks

- **Caption drifting from the image.** The caption names surface, state, theme, width, and what
  changed, so the reviewer can check it against the image in one glance.
- **A stale group after later commits.** Bounded by D7's replace-in-the-same-push rule.
- **Governance text drifting from practice.** One owner per layer (D9), with the template
  carrying the form and the Definition of Done carrying the procedure; neither restates the
  matrix.

## Declared gap

The section's first real render can only be observed on the next UI-visible pull request. That
pull request must confirm the images render and the captions stand alone before it merges; a
draft pull request could exercise it earlier. This is recorded in `validation.md` and is the
only part of this change that verification cannot execute here.
