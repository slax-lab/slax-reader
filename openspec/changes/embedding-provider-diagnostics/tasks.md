# Tasks

## 1. Safe diagnostics

- [x] 1.1 Add structured, bounded and redacted Jina failure logging; verify provider code/detail/request ID are retained without raw input, full response or credentials.
- [x] 1.2 Add success, malformed and sensitive-response tests while preserving existing embedding and retry tests.

## 2. Verification and PR delivery

- [x] 2.1 Run generation, typecheck, focused/full tests, lint, strict specs and dry-run builds; record verification.
- [x] 2.2 Open the diagnostic PR without deploying or replaying the test environment. Record live reproduction and final provider-code confirmation as a separate pending operation.

## 3. Final-failure-only diagnostics

- [x] 3.1 Carry the provider diagnostic on the thrown error and report it once from the terminal failure paths, so retried-and-recovered attempts emit no provider error log.
- [x] 3.2 Cover retried-then-succeeded batches, final failures and duplicate reporting in tests; record verification.
