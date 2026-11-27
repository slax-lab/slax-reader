# Tasks

## 1. Reproduce the endpoint regression

- [x] 1.1 In `apps/api/test/handler/http/imageProxy.test.ts`, build independently signed outer and inner URLs with a synthetic salt, distinct Referers, and known image bytes; run the focused test before the fix and record the failing assertion.
- [x] 1.2 Cover invalid outer checks (including a warm inner cache), invalid inner digest, both mode mismatches, lookalike origin/path, malformed fields or encoding, and three layers. Assert no shortcut to the original target for unsupported shapes.

## 2. Serve the verified inner request

- [x] 2.1 Implement bounded in-request resolution in the API serving path and make the regression test pass. Verify the requested upstream URL and Referer belong to the inner layer, or that its existing R2 object supplies the bytes without fetching.
- [x] 2.2 Extend `apps/api/test/utils/imageProxyReuse.test.ts` and `apps/api/test/handler/http/imageProxy.runtime.test.ts` to verify generated encoding, cache reuse, mode isolation and unchanged single-layer behavior. Verify RSS restrictions and ordinary range handling still apply.

## 3. Verify and deliver

- [x] 3.1 Exercise a local Worker with public example configuration and synthetic signing data: compare direct and double-wrapped GET status, headers, body digest and absence of an inner proxy redirect, then record observations or specific declared gaps in `validation.md`. Do not use production secrets.
- [x] 3.2 Run focused proxy tests, `pnpm api -- test test/script/layerArchitecture.test.ts`, API typecheck, lint, full tests and build, then `pnpm exec openspec validate --all --strict`. Record results and check git status for artifacts.
- [ ] 3.3 Perform the Bugs, Security and Compliance passes in `REVIEW.md`, then deliver a separate task PR to `dev` using the repository template, with `OpenSpec: serve-historical-nested-images`, root cause, test evidence and the conditional cache guidance. Do not merge, deploy or purge.
