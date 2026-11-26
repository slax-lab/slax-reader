# Verification

## Diagnosis

A TestFlight purchase showed "支付失败 / Invalid parameter" after StoreKit completed. The message is the English text of `ErrorName.ERROR_PARAM`. TestFlight builds call `https://api-reader.slax.com`, the production installation (`RUN_TYPE=prod`). `validateAppleApplication` required Production there, while TestFlight transactions are always Sandbox, so `check_inapp_purchase` threw `ErrorParam()` and the client kept the transaction unfinished.

## Automated checks (2026-11-24, task branch cut from `origin/dev` 3ff1b2e1)

Prisma clients and generated code were produced with the CI generation-only database URLs (`pnpm api -- config:init`, `pnpm api -- gen:all`). No secret file was read.

| Check | Result |
| --- | --- |
| `pnpm api -- test test/domain/subscriptionAppleSecurity.test.ts` with the source fix reverted | 2 failed (production Sandbox verification and production Sandbox notification), 42 passed |
| Same suite with the fix | 44 passed |
| `pnpm api -- test` | 280 files passed, 20 skipped; 4517 tests passed, 166 skipped |
| `pnpm api -- test test/script/layerArchitecture.test.ts` | 45 passed |
| `pnpm api -- typecheck` | passed |
| `pnpm api -- lint` | 0 errors; the warnings in `subscriptionApple.ts` predate this change and are outside the edited lines |
| `pnpm exec openspec validate --all --strict` | 169 passed |
| `git diff --check` | clean |

The tests cover production acceptance of Sandbox verification and notifications with `Sandbox`-qualified grant keys and scopes, rejection of an unknown environment for verification and both notification layers without side effects, and continued rejection of Production transactions on dev and beta.

## Not verified

The fix has not been exercised against a running production API with a real TestFlight purchase. A local run cannot produce an Apple-signed Sandbox JWS for the production bundle without a device purchase, and production deployment requires this change to merge and be promoted through `beta` to `main`. Task 2.2 records this post-deployment check: buy in TestFlight, confirm "支付成功", confirm the Pro entitlement and confirm the transaction no longer reappears on the subscription page.
