# Tasks

## 1. Safe diagnostics

- [x] 1.1 Add structured, bounded and redacted Jina failure logging; verify provider code/detail/request ID are retained without raw input, full response or credentials.
- [x] 1.2 Add success, malformed and sensitive-response tests while preserving existing embedding and retry tests.

## 2. Verification and PR delivery

- [x] 2.1 Run generation, typecheck, focused/full tests, lint, strict specs and dry-run builds; record verification.
- [ ] 2.2 Open the diagnostic PR without deploying or replaying the test environment. Record live reproduction and final provider-code confirmation as a separate pending operation.
