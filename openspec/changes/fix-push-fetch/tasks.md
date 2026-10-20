# Tasks

## 1. Notification transport

- [x] 1.1 Route all three sender formats through a manual-redirect JSON POST helper that rejects unsuccessful HTTP responses; verify successful payload and response behavior with the notification tests.
- [x] 1.2 Cover all four channels for successful sends, redirect rejection, HTTP failures, and private error details; retain environment and missing-destination coverage in the targeted test suite.

## 2. Validation and review

- [x] 2.1 Reproduce the original redirect-option failure in local workerd, then verify all four channels send successfully and reject redirected/error responses with intercepted endpoints.
- [x] 2.2 Run API tests and applicable static checks, validate all OpenSpec artifacts strictly, and complete the Bugs, Security, and Compliance pre-push review with no Important findings. Results and local environment limits are recorded in `validation.md`.
