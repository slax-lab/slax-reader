# Tasks

## 1. Provider

- [x] 1.1 Add the configured DeepSeek client and generated environment bindings; verify protocol, usage, truncation, empty replies, HTTP errors and cancellation tests.
- [x] 1.2 Switch all YouTube and podcast article text generation to deepseek-flash without provider fallback, update pricing admission and verify both runner suites and typecheck.

## 2. Delivery

- [x] 2.1 Remove version-selected YouTube generation paths; verify source-owned identity and ordering for both incident fixtures.
- [x] 2.2 Separate diagnostics from blocking validation and implement bounded smaller-request recovery with durable successful passages; verify ambiguous years, missing results, truncation, retries and restarts.
- [x] 2.3 Run independent chunks through rolling concurrency, parallelize independent reads and retain presentation fallbacks; verify failure isolation and concurrency bounds.
- [x] 2.4 Publish bodies before independent durable indexing and cleanup, return business outcomes and verify storage, lease, accounting and publication fault scenarios.

## 3. Verification and review

- [x] 3.1 Run both incident videos through the local delivery pipeline with actual DeepSeek after the operator supplies the key; record timing, coverage, output and cost evidence.
- [x] 3.2 Exercise the complete local workflow and fault scenarios in a running environment; record evidence and any limits in validation.md.
- [x] 3.3 Run required generation, automated checks and strict OpenSpec validation; perform Bugs, Security and Compliance review and record results.
- [x] 3.4 Open the task PR against dev after the requested real verification passes and close the automated review loop.

## 4. Workers runtime incident follow-up

- [x] 4.1 Reproduce the deployed redirect-mode failure in Workerd, replace unsupported error mode with manual redirect rejection, and cover successful requests and rejected redirects in the actual runtime.
- [x] 4.2 Record sanitized provider error codes and HTTP status in YouTube diagnostics without response bodies, credentials or request text.
- [x] 4.3 Run the current incident and both earlier fixtures against real DeepSeek through Workerd, rerun automated checks, and record verification limits.
- [ ] 4.4 Open and review the follow-up PR. Deployment and retry on the test environment require separate operator authorization.
