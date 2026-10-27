# Proposal

## Why

The YouTube task required a readable generated article. Passing error-state tests was reported as task completion, although generation remained unverified. Existing rules require running-environment checks, but do not clearly distinguish a component result from the user's requested outcome.

## What Changes

- Trace acceptance checks to the original user request and reported input.
- Identify real and substituted dependencies in each evidence record.
- Require terminal outcome evidence before claiming task completion.
- Keep declared gaps valid for review, but never treat them as verified success.
- Require reviewers to flag completion claims supported only by simulated intermediate states.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-verification`: evidence scope and completion claims.

## Impact

Update the verification procedure, review instructions, and PR template. No product code, CI gate implementation, dependency, or package version changes.

## Authorization

On 2026-10-27, Luca requested correction of the verification process and a separate PR if needed. This proposal implements that instruction. It does not change human acceptance, authorization, or release rules.
