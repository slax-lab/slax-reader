# Definition of Done

## Scope and change policy

- **Owns:** when verification applies, how to derive what to verify, how to record the
  evidence, and where each application's verification guide lives.
- **Does not own:** the normative verification requirements
  (`openspec/specs/change-verification/spec.md`); the material-UX demo offer and hands-on
  acceptance procedure (`DESIGN.md` §10.1 and §10.2); the design verification matrix
  (`DESIGN.md` §6); review enforcement (`REVIEW.md`); Mobile native acceptance details
  (`apps/mobile/AGENTS.md`).
- **Intake:** operational evidence procedure and links to the governing documents. A new
  verification threshold enters the normative spec first.
- **Outflow:** a new normative rule moves to `openspec/specs/change-verification/spec.md`; a
  UI procedure moves to `DESIGN.md` §10. Update inbound links and keep old links working.

This document owns the operational evidence procedure. The normative requirements are in
`openspec/specs/change-verification/spec.md`; `REVIEW.md` enforces them.

## When this applies

- **Behavior change.** A change that alters observable behavior is done only when the changed
  behavior has been exercised in a running environment; automated checks (typecheck, lint, unit
  and integration tests) must also run, but never substitute for the exercise.
- **Refactor.** A change that touches code without altering observable behavior records
  smoke-level verification derived from its diff's touched surface, any related living specs,
  and the affected app's documented smoke flows.
- **Exemption.** Documentation-, comment-, and typo-scale changes are exempt when the change
  states the exemption.

## Deriving what to verify

- **With a proposal:** exercise the change's delta-spec WHEN/THEN scenarios and the proposal's
  intent — they are the acceptance criteria — plus the affected app's documented smoke flows,
  which guard against regression.
- **Without a proposal:** derive smoke-level verification from the diff's touched surface, any
  related living specs, and the affected app's documented smoke flows.
- Drive the exercise with an agent wherever an agent can operate the environment (browser-use,
  computer-use, API calls). Human verification is reserved for what an agent cannot judge,
  such as whether behavior matches design intent.
- Declaring a gap — naming what was not verified and why — is acceptable evidence for
  agent-executable verification. Silence is not. The UI hands-on acceptance described below
  has no declared-gap path.

## Requested outcome and completion claims

- Start with the original user request and reported input. Include these checks beside the proposal and delta-spec checks.
- Record any user instruction that reduces the immediate scope. Keep the remaining outcomes explicit.
- Separate component checks from the requested outcome. Error recovery does not prove successful capture or article generation.
- Record the environment, real dependencies, substituted dependencies, reader role, and observed result for each outcome.
- Label each outcome `verified`, `partial`, or `unverified`. Explain each limit.
- For asynchronous work, check the terminal result and read the saved output separately. Use the intended reader role for shared content.
- Label fixture screenshots in the evidence record and attachment description. Do not present them as real service results.
- A declared agent-verification gap can permit review under the existing rules. It does not prove success for that outcome.
- Do not expand authorization to obtain evidence. State a gap when verification requires unavailable access or an unauthorized operation.

Example: a visitor can read every saved transcript entry. That verifies transcript access. It does not verify AI article generation.
A successful job without a readable saved article leaves the readable-article outcome partial.

## Recording evidence

- Record verification in `openspec/changes/<change-id>/validation.md`: commands run and their
  results, what was exercised in the running environment, and what was not verified with the
  reason.
- Summarize it in the pull request's Test plan with a link to `validation.md` when the details
  live there. Pull request bodies follow `.github/PULL_REQUEST_TEMPLATE.md`, never free text.
  A change without an OpenSpec proposal has no change directory; its Test plan entry is the
  record.
- Upload screenshots and recordings with `gh --attach` (requires gh v2.99.0+); never commit
  media to git. The text record must stand alone without the media — the automated review
  evaluates text only, and attachment links rot.

## UI-visible evidence

- The evidence satisfies the verification matrix in `DESIGN.md` §6, and covers the themes,
  responsive widths, and recorded states that `DESIGN.md` requires for the affected surface.
- The evidence records the acceptance required by `DESIGN.md` §10.2: who accepted, the date,
  and what was adjusted.
- The acceptance procedure and its no-declared-gap rule are owned by `DESIGN.md` §10.2.

## Per-application verification guides

- Web: `docs/web/development.md`
- Extension: `docs/extension/development.md`
- API: `docs/api/DEVELOPMENT-DOCUMENT-EN.md`
- CLI: `docs/cli/DEVELOPMENT.md`
- Mobile: `docs/mobile/README.md` and `apps/mobile/AGENTS.md`

## Review

`REVIEW.md`'s compliance pass enforces this contract. A missing or boilerplate evidence trail
is an Important finding; a declared agent-verification gap is not.
