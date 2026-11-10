# Tasks

## 1. Baseline and narrow hint filtering

- [x] 1.1 After proposal approval, build the unchanged base with production minification and synthetic configuration, retain its client manifest/HTML, and record the four-route dependency and prefetch baseline; verify the exact five target source identities exist and stop for review if provenance is unavailable.
- [x] 1.2 Add a narrow source-identity prefetch filter and wire build:manifest; verify unit fixtures cover all five loaders/transports, path separators, query suffixes, unknown entries and unrelated hints, and prove only prefetch metadata changes.
- [x] 1.3 Build the hint-only candidate and compare generated HTML/manifests with the base; verify targeted speculative hints disappear while required preloads, imports and Worker/WASM asset-index/retention checks remain valid.

## 2. Lightweight extraction entrypoint

- [x] 2.1 Move the two pure extraction helpers unchanged to the new text subpath, preserve old parse exports and add parity fixtures; verify exact outputs and that the narrow entry has no heavy-renderer runtime dependency.
- [x] 2.2 Switch the three extraction-only Web imports and their existing tests to the narrow entry; run focused parser/component tests and inspect the resulting closure, recording the measured zero raw-byte reduction of this slice.

## 3. Deferred article panels

- [x] 3.1 Load AI/chat implementations only on accepted activation, preserve existing automatic/permission rules and keep activated instances mounted; verify closed panels are absent, automatic opening works and reopening preserves draft/results.
- [x] 3.2 Preserve the first quote and focus request across asynchronous chat readiness, invalidating pending intent on page/account changes; verify exactly-once delivery, denied actions and recoverable load errors without arbitrary delays.

## 4. Deferred programmatic modals

- [x] 4.1 Replace eager modal implementations with per-action loading while preserving existing signatures and runtime constants; verify inputs, callbacks, focus, dismissal, stable identity and in-flight duplicate prevention.
- [x] 4.2 Provide recoverable import failure using existing feedback conventions; verify a failure does not leave an empty mounted modal or prevent a later successful retry.

## 5. Production measurement and handoff

- [x] 5.1 Build with matching settings, verify optional panel/modal code leaves initial static closures and does not return through speculative hints; extend only proven source-specific hint exclusions and confirm unrelated hints plus Worker/WASM index remain valid.
- [x] 5.2 Run standard Web tests, typecheck, lint and production build plus affected shared-consumer checks; verify no new diagnostics or unrelated generated output and obtain required application-version decisions before final handoff.
- [x] 5.3 Exercise built login, article, collection and library plus panel/modal cold first-use, reopening and error retry in the built-in browser; record real outcomes and explicit coverage gaps, including unverified remote sync or paired bridge behavior.
- [ ] 5.4 Update validation.md with original/minimum/expanded before-after static bytes, hinted bytes and observed requests; run strict OpenSpec validation and Bugs/Security/Compliance review, and obtain human hands-on acceptance for visible loading/error behavior before opening a PR.

The cached dynamic-import failure is fixed through demand-only JS/CSS dependency preflight. Real browser evidence shows 503, 503, 200 for entry JS, renderer JS, CSS and LoginModal, without page reload. Final first-quote interaction also passes. Extension remains at 1.16.3 following the no-bump recommendation and user-requested submission. Task 5.4 remains open for human hands-on acceptance. The user requested early draft publication; this does not mark acceptance complete. Recorded remote-service gaps remain explicit.
