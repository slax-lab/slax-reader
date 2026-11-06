# Validation

## Current correction

After PR #509 merged, the owner explicitly instructed using existing `/v1/bookmark/exists` as-is and removing the new receipt API. This correction is on `fix/share-recovery-use-exists` from `origin/dev@fe0bc43c` in `/Users/daguang/project/slax-reader-share-recovery`. It retains the approved `1.0.28 (800)`, previous source bound `799`, and does not introduce another version change.

The accepted scope is five-second creation timeout followed by one three-second existence check. Require HTTP200 and a complete JSON boolean `data.exists: true`; otherwise use existing timeout feedback. No special handling for normalization, trash, Reader forks, or parser readiness is added.

## Backend removal evidence

- Restored only the receipt-specific API source and tests introduced by commit `0a8c9ccb`; no unrelated API changes existed between that work and this corrective branch base.
- Regenerated route/dependency outputs with `pnpm api -- gen:all`, `SLAX_API_SKIP_DOTENV=1`, the documented example TOML, and synthetic generation-only local DB URLs. Generation passed; generated diff removes the four-line route registration. No generated file was hand-edited.
- `git diff 0a8c9ccb^ --exit-code -- apps/api` passed with no output: the API tree, including legacy `/exists`, is identical to its pre-#509 baseline.

## Automated verification

- Swift: `node --test apps/mobile/native/share/tests/collector.test.cjs apps/mobile/native/share/tests/diagnostics.test.cjs` passed **39 tests**, zero failures/skips, including 37 collector scenarios. Covers existing JSON true/false, missing/malformed/string/number values, HTTP204 rejection, incomplete/stalled/partial body, cancellation, auth/environment and counts.
- Android: `node --test --test-concurrency=1 apps/mobile/tests/share-native/android-transport.test.mjs apps/mobile/tests/share-native/android-diagnostics.test.mjs` passed **7 tests**, zero failures/skips, with 36 HTTP transport scenarios and 37 persisted diagnostic scenarios inside the host tests. An initial concurrent fixture wait failure was followed by passing isolated and sequential reruns; it is not hidden as a first-run pass.
- Restored API: `pnpm api -- typecheck` passed; the four existing controller/short-link/Reader/fork suites passed **76 tests**, zero failures. No receipt-specific test additions remain.
- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- bundle` passed for iOS and Android, exporting both bundles and metadata to `apps/mobile/dist`. No native compilation was run.
- Regenerated iOS source copies through the existing share plugin; version remains `1.0.28 (800)`.
- Focused Bugs/Security/Compliance review: original URL/token/origin preserved; HTTP200 and strict boolean true required; three-second lookup deadline covers response body; errors/partial JSON cannot recover; cancellation and original diagnostic evidence retained; API tree exactly restored. No unresolved Important issue found.
- Runtime-source search finds no new receipt methods/routes; the only remaining app-tree text reference is a negative test assertion prohibiting the removed route. `git diff --check` passed.

These are automated host/unit and bundle results, not native UI/device or full deployed-service acceptance.

## Boundaries

No native builds, devices, manual UI acceptance, extra runtime environments, schema changes, dependency additions, or deployment are part of this correction. The owner explicitly accepted automated tests and bundle verification for the conditional network behavior. No layout, assets, strings, animations, or accessibility presentation change.

Earlier native/expanded API experiments and their limitations are preserved in PR #509's historical validation at commit `8fddbb56`; this correction does not claim those experiments passed. The final tests here must cover the existing endpoint response body, not the removed bodyless contract.

No new API-before-client rollout prerequisite remains because the clients use the existing endpoint. Do not merge or publish automatically.
