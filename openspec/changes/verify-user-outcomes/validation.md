# Validation — 2026-10-27

## Change log

The verification procedure now connects completion claims to the original request and reported input.
The PR template records each outcome, dependency boundary, result, and limit.
The review procedure treats unsupported completion claims as Important Compliance findings.

## Evidence

This change updates documentation and the PR template only. It does not change shipped behavior or build output.
Running-application and package-version checks are exempt for this change. No human UI acceptance applies.

`openspec validate --all --strict`: 79 items passed, zero failed.
`git diff --check`: passed.

Manual rule evaluation:

| Evidence and claim | Expected classification | Rule result |
| --- | --- | --- |
| Fixture error and retry screenshots; claims generated article works | Unsupported completion claim | Important Compliance finding |
| Real visitor transcript; generated article explicitly unverified | Transcript verified; article unverified | Accurate partial handoff |
| Real model saves to isolated R2; claims production publication | Dependency boundary exceeded | Important Compliance finding |
| Job reports ready; saved output cannot be read | Readable-output outcome incomplete | Partial or unverified |
| Final check needs unavailable access; gap declared | Honest agent-verification gap | Existing human review decision remains |
| UI fixture checks pass; human acceptance absent | Existing acceptance requirement remains | Existing Important Compliance finding remains |

The new rules classify all six examples as expected. This is a documentation review, not an executable automated enforcement test.

## Local review

- Bugs: the result labels distinguish component results, final outcomes, and publication boundaries. No product code changes.
- Security: the rules do not authorize credentials, paid operations, or production writes. No dependency or secret changes.
- Compliance: the implementation matches `verify-user-outcomes`. Human acceptance and release requirements remain unchanged.

The existing rules already required real verification. This change cannot excuse the earlier incorrect completion claim.
It makes the missing distinction explicit and gives reviewers a specific check.

Archive remains pending until this PR merges.

## Review handoff

PR #409 targets `dev`. DGuang21 and Whyjsee received review requests.
The PR explains the false completion claim from #405 and links both media repair PRs.

## Review rework — 2026-10-29

Alex Lee (boxcounter) requested changes: keep the three durable requirements and rework the incident-specific details into conditional operational guidance.

- Delta spec: the independent read of a background result applies only when the requested outcome is a final user-visible state that a background process produces. The reader-role and real-or-substituted statements apply only when a screenshot or a shared-content read is presented as evidence. The incident wording left the scenarios.
- `docs/DEFINITION-OF-DONE.md`: five durable bullets, three conditional bullets under "Apply when relevant", one example.
- `REVIEW.md`: two bullets. The Important trigger carries the partial-result qualifier from the spec. The fixture-screenshot bullet and the transcript example were removed; the example lives in the procedure.
- `.github/PULL_REQUEST_TEMPLATE.md`: the five-column table was replaced by one comment sentence.
- `tasks.md`: task 6 records this rework.

Checks: `openspec validate --all --strict` passed (79 items). `git diff --check` passed. n/a for running-application checks: documentation and template only.
