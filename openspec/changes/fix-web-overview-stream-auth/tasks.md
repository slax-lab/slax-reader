# Tasks

## 1. Implement the Web overview fix

- [x] 1.1 Add regression coverage for ineligible viewers, rejected HTTP responses, invalid frames, and asynchronous read failure. Retain successful progress and completion coverage.
- [x] 1.2 Gate overview loading on panel eligibility, classify overview HTTP failures before reading, and settle failed reads and frames inside the panel.

## 2. Verify the change

- [x] 2.1 Run Web tests, type checking, lint, and strict OpenSpec validation.
- [x] 2.2 Exercise anonymous visitor, 401, and successful 200 paths in a running Web environment and record the evidence in `validation.md`.
- [x] 2.3 Complete the Bugs, Security, and Compliance review passes.
- [x] 2.4 Record human hands-on acceptance before opening a task pull request.
