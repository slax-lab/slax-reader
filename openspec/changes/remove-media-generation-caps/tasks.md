# Tasks

## 1. Remove admission caps

- [x] 1.1 Delete total-size and spending gates in both runners/planners; verify above-former-cap cases and cost accounting in runner tests.
- [x] 1.2 Delete daily quota and spend gates in both services; verify starts above former daily totals and existing concurrency/ownership checks.
- [x] 1.3 Enable explicit recovery of cap-rejected rows without clearing costs; verify repository and service retry scenarios including remaining terminal podcast errors.

## 2. Verification and delivery

- [x] 2.1 Run backend generators, relevant tests, typecheck, lint, and strict OpenSpec validation; record results.
- [x] 2.2 Exercise both pipelines in a local running environment, record evidence and any provider-verification gaps in validation.md.
- [x] 2.3 Complete Bugs/Security/Compliance pre-push review, create a PR to dev, and address Important review findings.
