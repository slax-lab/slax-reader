# Proposal

## Why

A rejected login request on `/auth` currently produces a transient raw-error toast and leaves the page spinning indefinitely. A request that never settles has the same result; refreshing the callback can then redeem the same single-use OAuth code again.

## What Changes

- Give the Web OAuth callback a persistent, localized failure state with a fresh provider sign-in action instead of an indefinite spinner.
- Bound the login attempt to 20 seconds, cancel the client request on timeout or page disposal, and prevent an abandoned attempt from storing a session or navigating later.
- Handle malformed callback state, network failures, provider rejection, and navigation errors at the callback boundary. Let this page own error presentation rather than also displaying a raw request toast.
- Preserve valid return targets, referral codes, Google/Apple provider selection, successful login behavior, and the existing Android handoff.
- Restart provider authorization on user action; do not automatically replay the callback code.

## Capabilities

### New Capabilities

- `web-auth-callback-recovery`: Bounded, recoverable Web OAuth callback failure handling.

### Modified Capabilities

None. PowerSync credential issuance and release recovery remain separate capabilities.

## Impact

Web `auth.vue`, the login composable's request options, English/Chinese messages, and targeted regressions. Reuse existing sign-in controls and semantic theme tokens. No backend, API contract, dependency, database, or Extension changes.

## Approval and delivery

On 2026-11-05 the requester reviewed the three-part proposal in conversation (persistent failure UI, an approximately 20-second timeout, and fresh Google authorization) and explicitly approved the minimal fallback. The requester authorized adding the work to either PR #467 or #449 without a new branch or PR. Use the existing clean `fix/powersync-release-recovery` worktree and PR #467, with this separate change ID, because its recovery scope is closer than PR #449's image/rendering work. This document records that approved conversation rather than requesting the same implementation permission again.

This is a bounded correction to callback failure handling using existing presentation patterns. Post-implementation human hands-on acceptance of the new visible states remains required before publishing the supplement. The production transport root cause and pre-mount database/startup stalls remain outside this change.

During preview review on 2026-11-05, the requester approved the overall recovery layout and requested a suitable SVG status icon above its title. Add a static, decorative circled-exclamation glyph using currentColor and existing Web accent tokens, retaining all callback behavior and existing controls. This follows the existing local status-page pattern rather than changing the navigation or screen structure. The requester also asked why the synthetic success destination is plain: it is intentionally a test receipt proving successful cookie storage and return navigation, not a production list-page mock. The requested icon adjustment is implemented and re-verified in the existing acceptance environment; validation.md records the human layout review and the resulting change.
