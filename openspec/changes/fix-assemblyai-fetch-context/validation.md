# Validation — 2026-10-31

## Running environment

The real `apps/api/src/infra/external/assemblyAI.ts` was bundled with esbuild into a Worker and run in workerd through miniflare 4.
The run used the API runtime settings from `test/runtime/httpSmoke.ts`: compatibility date `2025-05-05`, `nodejs_compat_v2`, and `global_fetch_strictly_public`.
A miniflare `outboundService` stub received every outbound request. The Worker called `submit('https://cdn.example.com/a.mp3', 'zh')` with a test key.

| Source | Result | Outbound requests |
| --- | --- | --- |
| `origin/dev` (`6deae73c`) | `Illegal invocation: function called with incorrect this reference` | none |
| This change | `submit ok: job-stub` | `POST https://api.assemblyai.com/v2/transcript` |

## Automated checks

- `vitest run test/infra/assemblyAI.test.ts`: the new test failed on `dev`, then all 9 tests passed with the fix.
- API `pnpm typecheck`: passed.
- API `pnpm lint`: zero errors.
- API `pnpm test`: 198 files passed, 14 skipped; 2700 tests passed, 113 skipped.
- `openspec validate --all --strict`: 90 passed, 0 failed.

## Not verified

- No real AssemblyAI request was sent. The local environment has no AssemblyAI key that the agent may read. Task 2.3 covers a real job after deployment.
- Production logs were not checked, so the number of affected episodes is unknown.

## Local review

- Bugs: the stored function is called without a receiver. Injected test fetchers still receive the same arguments.
- Security: no new input, URL, header, or secret handling.
- Compliance: change-id `fix-assemblyai-fetch-context`. No user interface change, so no hands-on acceptance is required.
