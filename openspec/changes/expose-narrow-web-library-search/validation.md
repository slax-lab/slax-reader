# Compact library search verification

## Browser exercise

November 25, 2026, Chrome 157.0.8103.79 on macOS, in an isolated local component fixture.

At 320, 390 and 860 CSS pixels the compact Search button was the visible search entry. Enter opened and focused the shared input. Submitting Rust showed the Rust book result without horizontal scrolling. Cancel and Escape cleared the query and returned focus to the same compact entry. At 861 pixels only the desktop input was visible. At 390 pixels the input and result remained usable with the fixture viewport reduced to 460 pixels tall.

The running fixture rendered the Web top bar and search components with local fixture data and a layout scaffold.

The same top bar was also loaded inside a native WKWebView on an iPhone 17 Pro simulator running iOS 26.5. XCUITest tapped Search, observed the system software keyboard, typed Rust, verified the input value, tapped the visible submit button and found the matching Rust book result. One test passed, zero failures.

## Automated checks

- Vitest, BookmarksSearchBar — 4 tests passed. The local Vitest configuration reused the repository test settings and allowed Vite to resolve the shared worktree dependency store.
- ESLint on changed Web source and test files — zero errors, zero warnings.
- `openspec validate --all --strict` — 175 passed, 0 failed.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
