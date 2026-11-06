# Tasks

The latest human instruction of 2026-11-06 supersedes both the earlier login/team authorization and the subsequent Authorization-Bearer Edge/Core middleware gate. The four strict single-target bodies remain; existing whitelist forwarding now reaches a Controller-first X-Vector-Refresh-Secret utility, with the server secret in Core only. Parent-reopened items below remain unchecked pending this revision's delegated verification. Retained checks describe unchanged earlier target/enumeration work, not acceptance of the new auth boundary. Earlier test logs remain historical. The worktree and unrelated changes must be preserved; no production secret/data/config operation or git mutation is authorized. Article-marker removal, the paused article feed and search limitations belong only to vector-v5-recommendation, not this capability delta.

## 1. Task authentication and HTTP boundary

- [x] 1.1 Add only the four refresh paths to the existing whitelist and remove task-specific middleware/Edge modes. Check X-Vector-Refresh-Secret at each Controller entry before path/body parsing; verify missing/wrong/empty secrets and user credentials without the task header cannot trigger work. Current 242-test focused run and real Workerd evidence are recorded in validation.md.
- [x] 1.2 Preserve and reverify four strict single-target Controller actions, canonical paths and direct IDs after moving the secret gate; reject arrays, unknown fields, old bodies and trailing-slash bypasses.
- [x] 1.3 Document the secret name for Core and caller only; regenerate routes/DI/types through real gen:all without hand edits or private-key access.

## 2. Isolated Domain processing

- [x] 2.1 Article refresh calls existing maintenance for exactly one private pair and no user/Collection/dependent targets; verify writes/reads and A/B identity isolation.
- [x] 2.2 Article-preference and Collection-preference actions each refresh exactly one user target using existing vectors; verify no embedding/source refresh and stale preferences clear for empty current histories.
- [x] 2.3 Collection action refreshes only its independent representation; verify no member embedding, subscriber enumeration or cascading Workflow.
- [x] 2.4 Remove superseded login/relation wrappers and unused types/lookups only where production callers are gone; verify live hooks and account deletion remain unchanged. Article recommendation admission is separately corrected in vector-v5-recommendation.

## 3. Sequential operator

- [x] 3.1 Enumerate article private pairs, active users once for each preference stage, and Collection IDs using bounded parameterized read-only pages; verify owner/ID/cursor semantics and zero-history user coverage.
- [x] 3.2 Send X-Vector-Refresh-Secret from environment without task Authorization or X-API-Key, with one raw target per request; reverify one outstanding call and secret-free logs.
- [x] 3.3 Preserve stage selection, dry-run, interruption, truthful outcomes and failure continuation with nonzero final exit; remove superseded Bearer help and test assumptions.

## 4. Integrated verification and release boundary

- [ ] 4.1 After production implementation finishes, run focused/full tests, typecheck, lint, strict OpenSpec and all four public-template Worker dry-run builds; report failures and skips separately.
- [x] 4.2 Exercise actual generated Edge/Core routes using the current whitelist/custom-header contract with a temporary local secret and isolated fixture dependencies; verify unauthorized requests produce no work and each accepted request affects only its stated target. No production secret or cloud data is used.
- [ ] 4.3 Complete scoped Bugs/Compliance review and update validation/operator instructions; separate required task-auth tests from deferred broad Security review and do not claim production deployment or historical refresh.
- [ ] 4.4 After the task pull request merges, classify every unchecked item and archive through the separate documentation pull request; never archive around missing evidence or silently waive release gates.
