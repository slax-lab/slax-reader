## Change summary

<!-- What does this PR change, and why? -->

## OpenSpec change

<!-- Behavior changes: the change id from openspec/changes/<id>. Refactors, docs, and tooling: write "n/a". -->

OpenSpec: 

## Linked issue

<!-- e.g. Closes #123 -->

## Test plan

<!-- Evidence is required (see "Definition of Done" in AGENTS.md): commands run and their results; the scenarios exercised in a running environment, derived from the change's WHEN/THEN scenarios plus the app's smoke flows; what was NOT verified and why. Link openspec/changes/<change-id>/validation.md when details live there. Attach screenshots/recordings with `gh --attach` — never commit them; the text here must stand alone without media. UI-visible changes: record the pre-PR human hands-on acceptance (who, when, what was adjusted). Documentation/typo-scale changes: write "n/a" with the reason. Refactors: state the diff-derived smoke verification (the diff's touched surface plus the app's documented smoke flows). -->

## Checklist

- [ ] Behavior exercised in a running environment and evidence recorded per the Test plan above (or exemption stated with its reason)
- [ ] No new secrets or environment variables added
- [ ] Documentation updated
- [ ] Agent rules/permissions changes (if any) were made in `.rulesync/` and regenerated with `pnpm agent:sync` — never hand-edit `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, or `.agents/`
- [ ] Read `REVIEW.md` — this PR is written to its Bugs/Security/Compliance passes and its Important-vs-Nit calibration
- [ ] Every Important finding from an earlier review round on this PR is fixed or explicitly answered
