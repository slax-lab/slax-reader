# Tasks

## 1. Safe diagnostics

- [ ] 1.1 Add structured, bounded and redacted Jina failure logging; verify provider code/detail/request ID are retained without raw input, full response or credentials.
- [ ] 1.2 Add success, malformed and sensitive-response tests while preserving existing embedding and retry tests.

## 2. Test-environment verification

- [ ] 2.1 Run generation, typecheck, focused/full tests, lint, strict specs and dry-run builds; record verification.
- [ ] 2.2 Deploy only to the authorized test environment, replay the two failures, extract provider code/detail and report the confirmed cause without exposing content or credentials.
