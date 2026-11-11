# Verification

Base revision: `bbd8fbb3` from `origin/dev`. The checks used Web production-profile builds with local synthetic public configuration.

## Browser comparison

Headless Chromium loaded the two builds from loopback HTTP servers. The fixture added 105 ms to static resource responses, used a fresh browser context for each navigation, bypassed the Service Worker, and blocked external network requests. It alternated the builds and used the same locale for each pair. Each median below covers five runs. Card readiness is the first insertion of the login button into the card DOM.

| Anonymous entry | Card readiness before | Card readiness after | LCP before | LCP after |
| --- | ---: | ---: | ---: | ---: |
| Direct `/login` | 1,679 ms | 1,233 ms | 1,704 ms | 1,284 ms |
| Root `/` to login | 2,868 ms | 2,404 ms | 2,924 ms | 2,500 ms |

- All anonymous root runs reached login without requesting the Inbox view. The login continuation retained the original pathname, campaign parameters, and fragment.
- Direct login requested its route from the initial document and skipped the default promotion host, invitation banner, and browser hint in an ordinary browser.
- The generated login document has 18 route asset hints and no generic prefetch links. The root and login documents each have two locale hints. Every hinted path resolves to an emitted asset. The generated bookmarks and guide documents retain their generic prefetch hints and receive no login hints.
- Both locale requests started in the first 50 ms of navigation. Chromium recorded one request for each locale with no additional selected-locale request. English and Chinese labels rendered. The second message file adds approximately 18–20 KiB if gzip-compressed.
- At 390 px, the dark Chinese invitation fixture displayed the invitation and the e-ink embedded-browser fixture displayed the browser hint. Ordinary login was also exercised in the light theme at desktop width.
- With a synthetic cookie and local API fixture, the root Inbox retained its KOC query and fragment, direct `/bookmarks` mounted the Inbox, and an authenticated `/login` redirected to `/bookmarks`. The fixture exercised mount and navigation rather than account validation or synchronization.
- Signed-in navigation was sampled once per route in this comparison. Direct `/bookmarks` recorded 2,812 ms before and 3,108 ms after. Its view now loads after route admission. A trial that started the import in page metadata caused Nuxt to emit an Inbox prefetch on anonymous root documents, so the trial was removed. The one sample is insufficient to estimate the normal signed-in timing impact.

## Automated checks

- Web production-profile build and Web app typecheck passed.
- ESLint on changed files reported zero errors and 18 warnings in the existing Inbox integration test. Full Web lint reported 89 errors in untouched files.
- Six focused files passed, covering 145 tests. These include login attribution, the Inbox view, the public startup and navigation guards, and the chatbot suite.
- Two full Web test runs, including a run with four workers, each passed 2,718 tests and timed out in one case in `tests/unit/utils/chatbot.spec.ts`. Three tests were skipped. The same chatbot file passed in the focused run, and the clean base passed 2,719 tests with the four-worker command. The timed-out case awaits a real external fixture image fetch in code untouched by this change. The cause of the difference between the full runs remains unconfirmed.
- `openspec validate --all --strict` passed with 121 items. `git diff --check` passed.

## Review

- Bugs: reviewed browser hints, locale reuse, redirect continuation, login state, and theme. Removed generic login prefetch links after the first browser pass exposed duplicate login resource discovery and unrelated prefetch. Independent Codex and Claude Code reviews prompted the cached Inbox check below.
- Security: resource URLs come from the Web build manifest and i18n prerender routes. Reviewed HTML attribute encoding and the unchanged route guard and session lifecycle.
- Compliance: the patch implements `web-login-resource-loading` and preserves the KOC root URL and the separate `public-page-startup` contract.

The anonymous login entry still preloads the shared PowerSync SDK chunk. The PowerSync plugin and the local-first adapter both retain value imports of the SDK or its Vue bindings. Moving only the initialization implementation behind a dynamic import would leave another eager path and would add a serial request before authenticated initialization. This change leaves the database boundary intact pending an independently measured split that meets the existing startup contract.

Real Google and Apple OAuth, Turnstile, native bridge behavior, PowerSync server synchronization, and production field LCP require their respective integration or deployed environments. The local browser fixture used synthetic responses and did not exercise those services.

## Cross-review follow-up

On the first return from `/user` to `/bookmarks?q=return-fixture`, the async Inbox child kept its original DOM and displayed the old search. The base consumed the new query. The child can miss initial activation when it mounts after its cached parent. Search handoff now checks whether the view has actually been deactivated.

The production-profile Chromium fixture passed cold `q` consumption, first return with a fresh search, reuse of the original Inbox DOM, and cold `nc` consumption on both the base and fixed builds. The fixture used synthetic local API data. The Inbox integration test mounts the actual async route wrapper under KeepAlive. It reproduced the stale search with the original guard and passed with the fix. The two focused Inbox and login suites passed all 63 tests after the fix.

## Local hands-on acceptance

On November 10, 2026, the requester exercised the local debug flow and approved opening the PR. The cross-review adjustment restored search handoff when returning to the cached Inbox. Two initial Google OAuth requests reached the local API on port 8787 with a matching client ID and localhost callback, then failed during the Worker fetch to Google's token endpoint with a connection loss and no provider response. Independent HTTPS probes also failed. The requester changed VPN and confirmed that the login test passed. The frontend OAuth callback, request payload, and API implementation have no changes in this branch.
