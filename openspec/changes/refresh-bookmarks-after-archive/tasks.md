# Tasks

## 1. Archive notification

- [x] 1.1 Add a failing regression for the reader archive action and account-scoped list notification.
- [x] 1.2 Publish successful archive changes with UUID and account identity; verify failed and obsolete writes publish nothing.

## 2. List recovery

- [x] 2.1 Refresh loaded REST pages atomically and local queries without database writes; verify archive, unarchive, and pending local changes.
- [x] 2.2 Recheck on foreground return and cached-page activation; verify duplicate events, request failures, pagination, and obsolete responses.

## 3. Verification and delivery

- [x] 3.1 Exercise the flow in a running browser and record evidence and remaining device gaps in validation.md.
- [x] 3.2 Run the Web tests, typecheck, changed-file lint, strict OpenSpec validation, and the local review passes; record results.
- [x] 3.3 Commit the tested fix on its task branch with a change log entry.
- [ ] 3.4 Obtain and record human hands-on acceptance before opening a pull request.
- [ ] 3.5 After the task pull request merges, classify remaining tasks and archive this change through a documentation pull request.
