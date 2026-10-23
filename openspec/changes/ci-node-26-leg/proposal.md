# Proposal

## Why

The root `package.json` declares Node.js support as `^22.22.2 || ^24.15.0 || >=26.0.0`, but CI only validates Node 22.22.2 and 24.15.0. The `>=26` claim is therefore unverified: nothing stops a Node 26-only regression from reaching users.

Node majors do change observable behavior. Node 25 made `assert.deepStrictEqual` compare object prototypes, so two tooling tests failed on Node 26 while passing on Node 22 — `util.parseEnv` returns null-prototype objects, and the assertions compared them against plain object literals (fixed in PR #368 by spreading the parsed result). That instance was caught by an operator, not by CI. A Node 26 leg turns this class of failure into a red check instead of a surprise.

## What Changes

- Append a pinned Node 26 leg to the existing compatibility matrix in `.github/workflows/cli-ci.yml`, next to 22.22.2 and 24.15.0. The CLI suite (typecheck, tests, package smoke) then runs on every declared support line.
- Convert the `check` job in `.github/workflows/tooling-ci.yml` from the single 22.22.2 version into a matrix of 22.22.2 plus the pinned Node 26 version.
- Pin the exact latest Node 26 patch release (`26.12.1`, the newest on nodejs.org/dist at the time of the change), matching the existing exact-version style; no floating `26.x`.
- Keep the required gate job names (`CLI CI gate`, `Tooling CI gate`) unchanged. A matrix job aggregates its legs into one job result, so the gates keep aggregating the whole matrix and `.github/rulesets.expected.json` needs no change; the extra legs appear as additional check contexts (e.g. `check (26.12.1)`).
- Do not add Node 26 legs to `frontend-ci.yml`, `api-ci.yml`, or `mobile-ci.yml`: their artifacts run in browsers, Cloudflare Workers, and mobile runtimes, and Node is only the build toolchain there.
- Fix any newly exposed Node 26 failures inside this change, applying the prototype-comparison pattern where that is the root cause.
- Record the CI Node coverage contract as a new capability, `ci-test-matrix`.

## Capabilities

### New Capabilities

- `ci-test-matrix`: which application suites CI runs on which pinned Node.js versions, how those versions relate to the declared `engines` support range, and how the required gate contexts aggregate the matrix.

### Modified Capabilities

(none)

## Impact

- `.github/workflows/cli-ci.yml`, `.github/workflows/tooling-ci.yml`; `tooling/ci-workflow.test.mjs` contract assertions.
- `openspec/changes/ci-node-26-leg/` artifacts.
- No application code, shipped UI/assets, runtime dependencies, or package output changes; CLI, Extension, and Mobile versions are unaffected.
- CI cost: one additional CLI matrix leg and one additional tooling check leg per pull request whose scope selects those suites.
