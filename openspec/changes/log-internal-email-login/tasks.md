# Tasks

## 1. Internal code delivery

- [x] 1.1 Add domain regression tests for log-only delivery in dev/beta/prod, exact-domain and login-purpose scope, unchanged response/digest/TTL and failure-before-log; observe failures before implementing the existing domain branch and constant.
- [x] 1.2 Regenerate backend artifacts and run API type checks, affected domain tests and layer architecture checks with no new drift or baseline exceptions.

## 2. Running verification and review

- [x] 2.1 Extend and run the existing HTTP smoke to read the internal code from Worker logs, prove no provider delivery, consume it through the existing login endpoint and reject reuse; retain ordinary authentication checks.
- [x] 2.2 Record Bugs/Security/Compliance review, running evidence and strict OpenSpec/whitespace results for a backend-only Draft PR targeting dev.
