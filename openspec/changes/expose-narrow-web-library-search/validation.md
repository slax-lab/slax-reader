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

## November 26 compact styling follow-up

The BookmarksSearchBar and SearchHeader suites passed all 19 tests using the repository's Vitest settings with the shared dependency store in Vite's allowed filesystem paths. Web application TypeScript and ESLint on the changed Web files passed. Strict OpenSpec validation passed all 194 items.

Chrome exercised the actual Nuxt library with synthetic REST responses. The fixture intercepted the local SQLite WASM request to exercise the application's REST fallback. At 390 CSS pixels in Chinese, the previous 52px-high form extended 2.5px above the 48px header. In the revision the 36px field is centered in a 56px header, the input measures 34px high, and each adjacent action has a 44px target. This held in light, dark and e-ink. At 320px, 390px, 768px and 860px, opening focused the input, the button and Enter submitted, Escape restored opener focus and the document fit the viewport. At 861px and 1024px the desktop inline input was visible.

Another 390px pass checked the IME guard with browser-dispatched composition events. Enter during composition left the previous search intact. After composition ended, tapping Submit updated the results. Keyboard activation of Clear emptied the query and focused the input, and activating the dismissal control returned focus to the opener.

The interactive preview loaded the actual Nuxt Inbox inside a 390px frame with a synthetic account and six bookmarks. Chrome opened search, submitted a query, displayed results, and returned focus to the opener after dismissal.

### Follow-up acceptance

On November 26, 2026, the requester approved the screenshots. After receiving the running 390px preview and the open, search, and dismiss steps, the requester confirmed to proceed with the follow-up pull request. The requester asked for no further adjustments.
