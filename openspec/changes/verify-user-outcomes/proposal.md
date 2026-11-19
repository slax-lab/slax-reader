# Proposal

## Why

The YouTube task required a readable generated article. Passing error-state tests was reported as task completion, although generation remained unverified. Existing rules require running-environment checks, but do not clearly distinguish a component result from the user's requested outcome.

## What Changes

- Trace acceptance checks to the original user request and reported input.
- Separate the requested outcome from component checks, and identify real and substituted dependencies in the evidence record.
- Keep declared gaps valid for review, but never treat them as verified success.
- Require reviewers to flag completion claims that exceed the outcome evidence.
- Keep the independent-read, reader-role, and substituted-screenshot checks as conditional guidance in the operational procedure, not as universal policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `change-verification`: evidence scope and completion claims.

## Impact

Update the verification procedure, review instructions, and PR template. No product code, CI gate implementation, dependency, or package version changes.

## Authorization

On 2026-10-27, Luca requested correction of the verification process and a separate PR if needed. This proposal implements that instruction. It does not change human acceptance, authorization, or release rules.
