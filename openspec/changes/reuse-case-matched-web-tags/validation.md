# Case-insensitive tag reuse verification

## Browser exercise

November 25, 2026, Chrome 157.0.8103.79 on macOS, in an isolated local component fixture.

Typing rust showed Rust and RUST as two distinct candidates with no creation row. Enter made no implicit choice. Selecting RUST produced its existing ID 4 and catalog spelling. With just Rust in the catalog, rust showed only that existing tag. Entering NewTopic offered creation and submitted the unchanged spelling.

Chrome exercised the REST-backed editor using a controlled catalog. The component suite also typed DESIGN for a local design tag and verified that the existing UUID was attached without creating a tag.

## Automated checks

- Vitest, BookmarkTags — 65 tests passed. The local Vitest configuration reused the repository test settings and allowed Vite to resolve the shared worktree dependency store.
- ESLint on changed Web source and test files — zero errors, 2 warnings in existing lines.
- `openspec validate --all --strict` — 175 passed, 0 failed.

## Follow-up review verification

Chrome 157 exercised Enter after selecting News and typing a query matching Rust and RUST. The request contained only the explicitly selected News ID. All 66 BookmarkTags tests passed. ESLint reported two pre-existing explicit-any warnings in the test file. OpenSpec strict validation passed all 175 items.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
