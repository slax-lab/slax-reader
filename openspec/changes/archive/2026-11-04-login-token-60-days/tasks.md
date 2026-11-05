# Tasks

## 1. Configure the approved lifetime

- [x] 1.1 Set the public template's `JWT_EXPIRES` to `5184000` and document private-environment rollout and existing-token behavior; verify the diff contains no application-source or client-package changes.

## 2. Verify and prepare delivery

- [x] 2.1 Exercise actual JWT issuance and signed expiration boundaries with the template configuration in a local HTTP harness; run the existing configuration and login-security tests and strict OpenSpec validation, recording results and explicit environment gaps in `validation.md`.
- [x] 2.2 Complete the local Bugs, Security and Compliance review against `REVIEW.md`, resolve Important findings, and record the version-scope assessment and rollout prerequisite before pushing.
