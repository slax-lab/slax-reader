# Tasks

## 1. Approval and reset selection

- [x] 1.1 Owner approved implementation on 2026-11-09 and explicitly required fixed-path detection instead of complex legacy classification. Work remains on fix/mobile-legacy-reset based on origin/dev; predecessor capability archival stays sequenced.
- [x] 1.2 Implement fixed old-database-family detection and a temporary interrupted-cleanup marker. Production Kotlin/Swift helper tests cover old/corrupt files, absent old files, retained old preferences alone, ordinary new storage, pending cleanup and repeated starts; schema/adoption records and app/network/token versions cannot trigger reset. Shared runtime tests cover historical pending logout and failed adoption metadata.

## 2. Native reset and minimal identity carryover

- [x] 2.1 Implement bounded Android file reset under existing ownership and preference serialization, without old SQLite inspection. Kotlin helper execution and actual emulator replacement verify owned database/cache cleanup, redirected-target rejection, pending-marker resume and ordinary new-storage preservation.
- [x] 2.2 Implement equivalent iOS private-container/App Group reset and shared-extension coordination. Swift helper/lifecycle tests exercise ownership and cleanup; actual simulator upgrade and corrupt-state runs verify new storage, retained identity or completed sign-out and no stale-token resurrection. Live share-extension concurrency remains part of the pending native interruption matrix in 4.3.
- [x] 2.3 Minimal best-effort preference import is implemented. Shared tests cover current-session precedence, corrupt preferences, pending logout and completion-before-SDK ordering; actual Android/iOS normal-screen relogin succeeds.

## 3. Startup and removal of obsolete migration code

- [x] 3.1 Startup initializes only the new slot after path-based preparation. Both native UIs repopulate through real isolated PowerSync; Android offline-to-online refill, corrupted-file reset and restart retention pass.
- [x] 3.2 Obsolete adoption/binding/cleanup blockers are retired together. Shared runtime and dedicated simulator corrupt-state runs verify successful new session acceptance; ordinary isolation regressions pass. External Google/Apple authorization is synthetic, explicitly separated from app-side acceptance.
- [x] 3.3 Remove production adoption/profile/installation/inspection code and preservation-only executable consumers. Keep real old-data producers and immutable historical reports. Runtime bundling has no old admission dependency; normal-screen acceptance exercises real production routes/runtime rather than the earlier JSON result page.
- [x] 3.4 Compatibility documentation and rulesync source guidance are updated; generated guidance and agent drift validation pass. Historical reports remain unchanged. Capability-purpose archival reconciliation remains sequenced with the already-merged predecessor delta, not silently applied to living specs before the task merge.

## 4. Integrated validation and delivery

- [x] 4.1 Standard mobile check passed 1,203 tests with no failures/skips; bundle, native resources, Android build 804 and clean generated iOS build 804 passed. Two later resolver-isolation tests passed separately. Build environment corrections and boundaries are recorded in validation.md.
- [x] 4.2 Both platforms executed same-identity replacement using genuine old Kotlin SDK data, actual production screens and real isolated PowerSync refill. Android and iOS logout/relogin/cold-start flows passed; corrupt legacy data with pending logout recovered. External OAuth is a labelled synthetic boundary, not real Google/Apple authorization. Exact scenarios and artifact provenance are recorded in validation.md.
- [ ] 4.3 Remaining verification: exhaustive native process termination at every deletion boundary on both platforms and simultaneous live share-extension activity. Production helper interruption tests, normal-Expo negative controls, actual cold restart, Android new-write retention and in-place native updates passed; these do not substitute for the unexecuted exhaustive matrix. Keep this task open rather than claim it ran.
- [x] 4.4 Evidence and limitations are recorded in validation.md. The owner approved 1.0.29 (804), and native metadata was regenerated. The owner explicitly directed direct PR submission without a separate manual UI acceptance step for this storage-flow change; no manual hands-on execution is claimed. Store publication remains unauthorized.
- [x] 4.5 Local Bugs/Security/Compliance review, 1,205-test final Mobile check, strict specification/generated-file validation and diff checks passed. Implementation commit 412294c4 was pushed on fix/mobile-legacy-reset and PR #547 was opened against dev with five reviewed simulator screenshots. Initial state: OPEN, MERGEABLE, REVIEW_REQUIRED; CI and remote review are still running. No merge, deployment or archive performed.
