# Validation

On November 25, 2026, the change requester chose to keep Mobile at 1.0.33 (808).

## Running checks

- Served the production-prerendered Web output locally. In Chrome, visited both Chinese links at 390 px with an English Web preference, both English links at 768 px with a Chinese Web preference, and both ordinary links at 1280 px. Checked each document title, content language, first and last section headings, final paragraph and the preference cookie after navigation. All six visits passed.
- Exercised the branch's real React Native LoginScreen and its react-native-webview on an iPhone 17 Pro simulator running iOS 26.5. Used a disposable Expo development client with a navigation host and isolated session and locale inputs. XCUITest opened the login agreement, switched to Privacy, closed it, changed the host language and repeated. The WebView accessibility tree contained the first and last sections of all four published documents. A full production account startup was not used. The existing fixture client lacked the shared application group needed to initialize account storage.
- The four embedded URLs use static HTML and do not hydrate the site's locale selection. Browser validation caught both a login redirect and a cookie overwrite during development. Those cases were retested on the corrected pages.

## Automated checks

- Web agreement integration suites passed 13 tests. The checkout uses shared pnpm dependencies. A temporary Vitest config allowed their real filesystem root and tests ran with a single worker.
- The mounted Mobile login suite passed all 51 tests, including both agreement tabs in Chinese and English.
- The first PR CI run found two additional mounted login cases that still mocked a locale-free runtime and expected unlocalized URLs. The updated fixture supplies a locale and asserts both localized tabs and WebView reuse on iOS and Android. The two focused Mobile suites passed all 75 tests.
- Mobile architecture, asset, fixture, RSS and TypeScript checks passed. The full Mobile test discovery run was stopped to avoid overloading this machine. The targeted mounted login suite completed independently.
- The production Cloudflare Pages build passed. Exact route rules prerender the four embedded documents with the general prerender route list left empty.
- The full Mobile Expo export for iOS and Android passed.
- OpenSpec strict validation passed 175 items. The local diff whitespace check passed.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
