# Verification

Verified on macOS arm64 with Node.js v22.23.1 and pnpm 11.25.0, on branch `chore/drop-core-host-allowlist`, based on dev at `5d56b7b`.

## Checks

| Check | Result |
| --- | --- |
| `pnpm exec openspec validate --all --strict` | 11 passed, 0 failed, including `change/drop-core-host-allowlist` |
| `pnpm api -- lint` | 0 errors, 336 warnings (the repository's existing warning set) |
| `pnpm api -- typecheck` | Passed: contracts typecheck, then `tsc --project tsconfig.json --noEmit` |
| `pnpm api -- test` | 1505 passed, 46 skipped, 0 failed (150 files) |

`pnpm api -- build` and the Worker runtime checks were not run on this branch; the change is confined to the Core entry's request dispatch.

## Structural confirmation of the behavior change

- `apps/api/src/di/router.ts` no longer exists, and `apps/api/src/entry/core/index.ts` imports `getRouter` from `@/di/generated/readerRouter`, calling it with the container alone.
- The entry no longer reads `env.BACKEND_API_PREFIX`. The only remaining runtime reference is the Twitter OAuth callback URL in `apps/api/src/utils/auth/authTwitter.ts:57`; the deploy tooling keeps its own requirement for the value.
- `apps/api/test/script/deploymentRouting.test.ts` no longer imports the wrapper or mocks the generated router; its remaining cases cover consumer routing.

## Limits

- The removed cases (`reader.example.com.attacker.test`, `reader.example.com:8443`, `arbitrary.test` with an invalid origin) were the only pin on Host rejection. No test now covers what happens when a request arrives under an unknown Host; they would be accepted and routed.
- No Worker was started behind a live route, so the change is verified structurally and through the unit suite rather than by an HTTP request under a spoofed Host. The RSS branch was verified separately after restoring the wrapper: 1602 passed, 46 skipped, 0 failed.
- The local pre-push review defined in `REVIEW.md` has not been run: this branch is committed locally and not pushed. Its Security pass would report precisely the missing runtime guard that `design.md` records under Risks.
