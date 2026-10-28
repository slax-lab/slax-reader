## Change summary

<!-- What does this PR change, and why? -->

## Key visuals

<!-- 1–3 visual groups for a change that alters what a user sees, so a reviewer meets the change before the evidence trail: a surface that already ships gets a before/after pair as one group, a new surface gets after only, and a removed surface before only, all in the same state, theme, and width and captioned with the surface, state, theme, width, and what changed. A motion-only change — transition, drag, or scroll-linked behavior a still cannot show — gets a short recording as its group, and its caption names what to watch. More groups only when the change spans independent surfaces, with the reason stated. The complete state/theme/width evidence stays in the Test plan; these groups present it and neither extend nor replace it. Attach with `gh --attach` and never commit media; the captions must stand alone without the images. Write "n/a" with the reason only for a change with no visible surface, or for a visible change a still cannot usefully show that is outside the motion cases above. A later push that changes what a group shows replaces that group here. -->

## OpenSpec change

<!-- Behavior changes: the change id from openspec/changes/<id>. Refactors, docs, and tooling: write "n/a". -->

OpenSpec: 

## Linked issue

<!-- e.g. Closes #123 -->

## Test plan

<!-- Evidence is required (see `docs/DEFINITION-OF-DONE.md`): commands run and their results; the scenarios exercised in a running environment, derived from the change's WHEN/THEN scenarios plus the app's smoke flows; what was NOT verified and why. Link openspec/changes/<change-id>/validation.md when details live there. Attach screenshots/recordings with `gh --attach` — never commit them; the text here must stand alone without media. UI-visible changes: record the pre-PR human hands-on acceptance (who, when, what was adjusted). Documentation-, comment-, and typo-scale changes: write "n/a" with the reason. Refactors: state the diff-derived smoke verification (the diff's touched surface, any related living specs, and the app's documented smoke flows). -->

## Checklist

- [ ] Behavior exercised in a running environment and evidence recorded per the Test plan above (or exemption stated with its reason)
- [ ] No new secrets or environment variables added
- [ ] Documentation updated
- [ ] Agent rules/permissions changes (if any) were made in `.rulesync/` and regenerated with `pnpm agent:sync`; change generated outputs only through their generators
- [ ] Read `REVIEW.md` — this PR is written to its Bugs/Security/Compliance passes and its Important-vs-Nit calibration
- [ ] Every Important finding from an earlier review round on this PR is fixed or explicitly answered
