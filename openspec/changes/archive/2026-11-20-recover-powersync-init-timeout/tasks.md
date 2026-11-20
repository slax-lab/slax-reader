# Tasks

## 1. Approval and regressions

- [x] 1.1 Record the human request to implement the timeout recovery and open a pull request; verify the scope keeps the SDK, VFS, timeout, and database identity unchanged.
- [x] 1.2 Reproduce the timeout in Chrome with the real SDK and a second tab holding the shared write lease past the timeout; record that the page stays on REST after the lease is released.

## 2. Implementation

- [x] 2.1 Retain the timed-out instance and return its pending background initialization; verify no disposal, no second instance, unchanged cleanup-timeout and cleanup-error stops, and background-ready and background-error events.
- [x] 2.2 Install a one-shot navigation guard for eligible top-level pages after background completion; verify a different path performs a full document load, same-path navigation stays client-side, an incomplete or failed background initialization installs nothing, and the bridge never installs the guard.
- [x] 2.3 Log background outcomes and timeout visibility in the existing diagnostics; verify the messages and fields.

## 3. Verification and review

- [x] 3.1 Run the affected Web unit tests, typecheck, lint on touched files, and a production-profile build.
- [x] 3.2 Exercise the production build in Chrome: timeout under a held lease, release, navigation returns to local mode with synchronization requested; confirm unchanged behavior without a timeout. Record evidence in `validation.md`, run strict OpenSpec validation, and complete the local Bugs, Security, and Compliance review.
