# Design

## Context

PR #405 tested request recovery with simulated status responses. The user expected a readable article from a reported YouTube bookmark.
The completion claim exceeded the evidence. Existing rules already required running-environment verification. The execution also failed that requirement.

## Goals

Connect completion claims to the user request, the reported input, and the final visible result.
Keep partial results useful for review while stating their limits.

## Decisions

Add requirements to the existing change-verification capability. Update its procedure, review checks, and PR template together.
Use three outcome labels: verified, partial, and unverified. Record real dependencies and substituted dependencies beside each result.
For background work, verify the saved result through a separate read after processing finishes.
For shared content, verify the result with the intended reader role.

A declared gap can permit review under existing rules. It cannot establish success for that outcome.
Do not require production writes, additional access, or paid operations without existing authorization.
Human hands-on acceptance and release requirements remain unchanged.

## Validation

Apply the requirements to examples from this incident. A simulated preparing state cannot prove article generation.
A real visitor transcript check proves transcript access. It cannot prove generated article access.
A completed job without a readable saved result remains partial.

## Risks

A large evidence form can discourage useful records. Keep the template to one small table and a short limits statement.
The procedure requires accurate judgment. It does not add an automatic gate that claims to inspect screenshots or understand user intent.
