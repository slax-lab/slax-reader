# Tasks

## 1. Approval

- [x] 1.1 Record the requester's approval to implement only the deferred-startup request with careful permission handling and other applicable routes; verify the scope keeps the Inbox, bridge, SSR, caching, and database identity unchanged.

## 2. Implementation

- [x] 2.1 Add the deferred route policy; verify matching for `/b/<id>`, `/user`, `/collection/manage`, trailing slashes, and non-matching routes.
- [x] 2.2 Defer local startup in the plugin with the readiness API; verify mount without waiting, readiness only after recovery, data-version, and account checks, REST behavior on failure, unchanged blocking startup elsewhere, and bridge, bypass, and session-recovery exclusions.
- [x] 2.3 Add the exit guard; verify the document load to non-deferrable destinations, client-side navigation among deferrable routes, the bounded wait, and ignored non-internal destinations.
- [x] 2.4 Upgrade `/b/[id]` for a verified owner; verify each ownership condition, the switch without body reload, and REST writes before the switch.

## 3. Verification and review

- [x] 3.1 Run affected Web unit tests, typecheck, touched-file lint, the full Web suite, and a production-profile build.
- [ ] 3.2 Exercise in Chrome with a held database lease: `/b/[id]` and `/user` mount time, REST interaction, owner upgrade and visitor non-upgrade, leaving to `/bookmarks`, unchanged `/bookmarks` startup, and anonymous body HTML. Record evidence in `validation.md`, run strict OpenSpec validation, and complete the local Bugs, Security, and Compliance review.
