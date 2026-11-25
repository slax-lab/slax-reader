# Search result order verification

## Browser exercise

November 25, 2026, Chrome 157.0.8103.79 on macOS, in an isolated local component fixture.

Chrome rendered the search bar, results view and empty/error actions with deferred request responses. Rust resolved after JavaScript; all three JavaScript rows and their count stayed visible. After a successful Rust query, Images failed; the editable input retained Images, the old rows and count disappeared, and Retry sent Images and displayed its result. A stale rejection after a newer empty success left the empty state visible without an error or spinner.

The transport was controlled to produce deterministic completion order and failure. Search ranking and a live backend were outside this exercise.

## Automated checks

- Vitest, SearchHeader — 13 tests passed. The local Vitest configuration reused the repository test settings and allowed Vite to resolve the shared worktree dependency store.
- ESLint on changed Web source and test files — zero errors, zero warnings.
- `openspec validate --all --strict` — 175 passed, 0 failed.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
