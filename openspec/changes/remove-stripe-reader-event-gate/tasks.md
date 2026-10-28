# Tasks

## 1. Implementation

- [x] 1.1 Remove the platform marker gate in callback and payment paths; verify focused regression cases for missing/other platform and retained ownership checks.
- [x] 1.2 Generate the operator recovery SQL for the confirmed invoices; verify first execution, rollback on stale evidence, and idempotent rerun in an isolated PostgreSQL runtime.
- [x] 1.3 Remove the global Stripe mode switch from all runtime paths, environment bindings, tests, and deployment documentation; verify live processing without the flag and exclusion of test-mode events.

## 2. Verification

- [x] 2.1 Run applicable API checks and generator commands, record running-environment evidence or explicit gaps, and pass strict OpenSpec validation.
- [x] 2.2 Review the final diff for Bugs, Security, and Compliance, and resolve Important findings.

## 3. Post-merge

- [ ] 3.1 After the task pull request merges, classify any unchecked tasks and archive this change through a separate documentation pull request.
