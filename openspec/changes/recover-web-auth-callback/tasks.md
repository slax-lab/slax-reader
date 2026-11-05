# Tasks

## 1. Regression and implementation

- [x] 1.1 Add failing callback-page and login-composable regressions for failure recovery, timeout, cancellation, fresh provider authorization, malformed state, and preserved success/handoff behavior; record the expected red run.
- [x] 1.2 Expose login request cancellation and per-request error presentation, preventing cookie writes after cancellation; verify the composable regressions pass.
- [x] 1.3 Implement localized persistent callback recovery, 20-second timeout, fresh provider actions, and lifecycle cleanup; verify callback regressions pass.

## 2. Verification and delivery

- [x] 2.1 Exercise the real callback/request flow against a local HTTP fault service, including disconnect, pending, provider rejection, success, fresh authorization, and required themes/widths; record evidence and explicit gaps in validation.md.
- [x] 2.2 Run the Web suite, typecheck, changed-file lint, build, and strict OpenSpec validation; perform the REVIEW.md Bugs/Security/Compliance passes and record results.
- [ ] 2.3 Prepare the running environment for human hands-on acceptance, record who/date/adjustments after acceptance, then update the existing PR #467 description and branch without opening a new PR.
