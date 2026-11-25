# Validation

## Production Web reader

On November 25, 2026, built the production Web client, worker, precache manifest and Cloudflare Pages worker with the opt-in `tests/fixtures/offline-reader` Nuxt layer. Only the upstream authorization, article body and revision controls are synthetic. Served the result with local Wrangler Pages at http://127.0.0.1:4187. The fixture uses a 60-paragraph article with distinct first and last paragraphs.

- From a new Chrome profile, opened the share URL and read the live article to paragraph 60. Reopened the canonical URL and the original share URL fully offline and checked the title, first and last paragraphs, saved-copy status and retry link. An unvisited URL showed the unavailable state. Updated the live article and verified both URLs used the revision. Retried online after revocation, went offline again and verified the old body was unavailable.
- An owner-only document returned 200 on the authenticated navigation and 404 on the anonymous admission request. Reopening it offline did not expose its body. The offline cache was also checked for exclusion of account annotations.
- Repeated this journey with Chrome at 390 px in light, 768 px in e-ink and 1280 px in dark. All three runs passed.
- On an iPhone 17 Pro simulator running iOS 26.5, opened the share URL in Safari, disconnected the local TCP proxy, reopened the URL and verified the saved-copy status and the first and last paragraphs using XCUITest. Restored the proxy, used Retry after revocation and disabled the proxy again. The original alias showed the unavailable state.
- Repeated the offline share reopen and post-revocation check through the real Slax native browser adapter. An isolated React Native screen called `openInAppBrowser`, the same adapter used by article links. The iOS module presented SFSafariViewController. XCUITest cold-relaunched the host after disconnecting the local proxy and checked both the first and last paragraphs. Retry on reconnection followed by another disconnected cold open showed the unavailable state. The app-hosted browser and standalone Safari runs both passed on iOS 26.5.
- Also tested deletion of offline storage in both Safari and the app-hosted Safari browser. An isolated page on the test origin confirmed the previously admitted canonical article existed, requested worker unregistration, removed Cache Storage entries and cleared Web Storage. The harness terminated the browser or host process, disconnected the origin and reopened exactly the same URL. Neither browser showed the deleted article. Safari reported that the article was unavailable offline, while the app-hosted browser reported a navigation failure. These checks exercised a simulator rather than physical hardware.
- A plain third-party-style WKWebView on the same simulator exposed no service-worker API. It displayed the live first and last paragraphs and reported a network navigation error on a cold offline reopen. A site cannot install the production worker into that host. The Slax iOS reader uses SFSafariViewController to open article links.

## Repeatable checks

- Production build: `SLAX_ENV=production pnpm --dir apps/web exec nuxt build --dotenv /dev/null --extends ./tests/fixtures/offline-reader` with all public origins pointing to the local server and synthetic cookie and OAuth names.
- Browser exercise: `python3 -B apps/web/tests/fixtures/offline-reader/browser_check.py` with `CHROME_BIN` pointing to local Chrome.
- Focused reader suite: six tests passed using the project Nuxt Vitest configuration with happy-dom. Covers text-only persistence, titles, escaping, both real URL shapes, denied HTTP navigation without hydration, stale/updated copies, private ownership and PDFs.
- `openspec validate --all --strict` passed all 175 items. `git diff --check` passed.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
