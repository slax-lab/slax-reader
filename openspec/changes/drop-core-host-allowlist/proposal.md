# Proposal

## Why

The Core worker validated the request Host in a hand-written wrapper, `apps/api/src/di/router.ts`. It returned the generated router only when the Host matched the operator's explicit `BACKEND_API_PREFIX` origin (exact match, HTTP(S) protocol, no credentials) or a fixed list of legacy hosts, and `null` otherwise; `apps/api/src/entry/core/index.ts` turned that `null` into a `host not found` failure. A regression test pinned the anti-spoofing cases: `reader.example.com` accepted with a matching configured origin, `reader.example.com.attacker.test` and `reader.example.com:8443` rejected.

That wrapper was deleted during the RSS work, together with the regression case and the runtime rejection, and nothing replaced the control. No part of the RSS change needed it: the generated `readerRouter.ts` is Host-agnostic, and `BACKEND_API_PREFIX` is referenced elsewhere only by the Twitter OAuth callback URL. The deletion is therefore unrelated to RSS and cannot be reviewed inside that change, where it also contradicts the `api-command-proxy` design statement that the API accepts the explicit `BACKEND_API_PREFIX` Host.

This change isolates the deletion so it can be reviewed and decided on its own merits.

## What Changes

- Delete `apps/api/src/di/router.ts` and call the generated `getRouter(currentContainer)` directly from `apps/api/src/entry/core/index.ts`, removing the `host not found` rejection.
- Remove the deployment-routing regression case that pinned host rejection, leaving the consumer-routing cases in `apps/api/test/script/deploymentRouting.test.ts`.
- Drop the host-routing wording from the `BACKEND_API_PREFIX` validation error in `apps/api/script/deploy/config.ts`, which described the deleted check; the requirement itself and its origin validation stay.
- Correct the contradictory statement in `openspec/changes/api-command-proxy/design.md` so that artifact no longer claims Host validation the code does not perform.
- Record the security consequence explicitly: no runtime Host validation remains, and no replacement guard is part of this change.
- Keep the same removal out of the RSS change, which restores the wrapper, the entry wiring, and the regression case.

## Capabilities

### New Capabilities

- `core-host-routing`: How the Core worker's HTTP entry treats the request Host, and what protects the worker from unintended hostnames once runtime validation is gone.

### Modified Capabilities

None. `api-command-proxy` is an active change rather than an archived capability, so its design statement is corrected in place instead of through a delta.

## Impact

`apps/api/src/di/router.ts` (deleted), `apps/api/src/entry/core/index.ts`, `apps/api/test/script/deploymentRouting.test.ts`, and the `api-command-proxy` design artifact. No API contract, database schema, or `packages/contracts` change. The behavior change is observable: a request that reaches the Core worker under an unknown Host is now served instead of rejected.
