# Tasks

## 1. Isolate the routing deletion

- [x] 1.1 Delete `apps/api/src/di/router.ts`, the hand-written wrapper whose only other contribution was the Host decision.
- [x] 1.2 Call the generated `getRouter(currentContainer)` from `apps/api/src/entry/core/index.ts` and remove the `Failed('host not found')` rejection, so the entry no longer consumes `env.BACKEND_API_PREFIX`.
- [x] 1.3 Remove the deployment-routing regression case that pinned acceptance of the configured origin and rejection of `reader.example.com.attacker.test`, `reader.example.com:8443`, and `arbitrary.test`; keep the consumer-routing cases in the same file.
- [x] 1.4 Drop the stale host-routing wording from the `BACKEND_API_PREFIX` validation error in `apps/api/script/deploy/config.ts`; the value stays required and its origin validation is unchanged.

## 2. Keep the deletion out of the RSS change

- [x] 2.1 Restore `apps/api/src/di/router.ts`, the entry wiring, and the removed regression case on the RSS branch, so that change carries only RSS. Identical to dev for those three files.

## 3. Artifacts

- [x] 3.1 Correct the `api-command-proxy` design statement that claims the API accepts the explicit `BACKEND_API_PREFIX` Host and keeps legacy Host compatibility.
- [x] 3.2 Record in this change's design the consequence of dropping the control, what still protects Core, and the alternative of reinstating the check elsewhere.

## 4. Verification

- [x] 4.1 Run `pnpm api -- lint`, `pnpm api -- typecheck`, `pnpm api -- test`, and `openspec validate --all --strict` on this branch; record the outcomes in `verification.md`.
- [ ] 4.2 Run the local pre-push review defined in `REVIEW.md` — not applicable while this branch stays local; run it before pushing and resolve its Important findings.
