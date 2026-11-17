# Reader startup regression lab

This opt-in Nuxt layer uses the real reader, router, account store, article renderer,
and disposable browser-local PowerSync database. For local marked samples, only the
remote stream checkpoint is simulated; the SQL tables and query watchers are real. Only backend content and API replies
are synthetic. It is not loaded in the shipped application and never changes a real
account, subscription, bookmark, or server database.

From the repository root, use explicit non-secret fixture configuration:

```sh
PUBLIC_BASE_URL=http://127.0.0.1:3218 \
AUTH_BASE_URL=http://127.0.0.1:3218 \
COOKIE_DOMAIN=127.0.0.1 COOKIE_TOKEN_NAME=slax_reader_test \
SHARE_BASE_URL=http://127.0.0.1:3218 \
DWEB_API_BASE_URL=http://127.0.0.1:3218 \
GOOGLE_OAUTH_CLIENT_ID=synthetic \
pnpm web -- dev --host 127.0.0.1 --port 3218 --extends ./tests/fixtures/reader-startup
```

Do not run Nuxt prepare/typecheck/Vitest in this worktree concurrently with the dev
server: they share generated Nuxt files. Restart the server after those checks.

Open [the lab](http://127.0.0.1:3218/reader-fixture) for manual acceptance. Its links
choose an active, expired, failed-once, or anonymous synthetic account. Scroll while
startup is delayed, or select Chat/Analysis while the profile is checking. A failed
profile can be retried; an expired profile retains the upgrade flow. The manual-only Article A/B buttons use the real Nuxt router; use browser Back/Forward
to compare the destination. With no reading
interaction, the seeded local bookmark should restore Passage 15.

The browser scripts require Python Playwright and a compatible headless Chromium.
The executable path in these scripts names the installed local test browser; adjust
it for another machine. They create disposable browser contexts and write JSON,
screenshots, and videos to `/tmp/slax-reader-startup-evidence`; media is not committed.

```sh
python3 apps/web/tests/fixtures/reader-startup/browser_check.py
python3 apps/web/tests/fixtures/reader-startup/browser_check.py --permissions-only
python3 apps/web/tests/fixtures/reader-startup/browser_navigation_check.py
python3 apps/web/tests/fixtures/reader-startup/browser_surface_check.py
```

The main runner independently holds the actual client entry module, profile reply,
local-ready lookup and saved-position query. It checks application scroll calls,
visible paragraphs, ordinary navigation, deliberately conflicting history/local
anchors, saved-progress positive controls, and subscription decisions. The navigation
runner exercises the existing highlight/reply query consumption, comment-card and
Outline locators. The presentation runner covers checking/error/retry at three widths
and three Web themes. Consult the change's `validation.md` for actual results and gaps;
the presence of a script alone does not claim it passed.

## Sidebar component loading

For hands-on acceptance, choose **Centered panel loading** in the lab (or open
`/reader-fixture?case=loading`). The opt-in Vite layer delays each AI/Chat component
module by 2.5 seconds for that synthetic browser session. Open Analysis or Chat to
inspect the centered placeholder and its replacement by the real panel. Reload to
repeat a first-use load; selecting another lab scenario clears the module delay.
This middleware is absent from ordinary development and shipped builds.

The panel runner holds the actual component module independently of profile replies,
checks its center against the live content slot at 375/768/1280px in all three themes,
checks reduced motion, and releases the module to verify loaded content. Desktop
light cases also switch to Comments or close the sidebar during loading and verify
the selection is retained before reopening. It uses Playwright's installed browser by
default; pass `--browser-executable /absolute/path/to/browser` to select another.

```sh
python3 -B apps/web/tests/fixtures/reader-startup/browser_panel_loading_check.py
python3 -B apps/web/tests/fixtures/reader-startup/browser_panel_loading_check.py --selection-only
# On the unmodified target branch, captures the top-left baseline instead:
python3 -B apps/web/tests/fixtures/reader-startup/browser_panel_loading_check.py --before
```

## Panel entry feedback

`browser_panel_feedback_check.py` covers clicks while the real client entry module is
held, one-time activation after hydration, latest-choice replacement, source-page
controls during pending navigation, component module completion/rejection/timeout,
subscription decisions, keyboard activation, reduced motion, and the three-theme /
three-width presentation matrix. Its default server URL is `http://127.0.0.1:3228`;
use `--base-url` for a different port. Use the same opt-in layer and synthetic
configuration above, with the URL and port changed consistently when needed.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/web/tests/fixtures/reader-startup/browser_panel_feedback_check.py --base-url http://127.0.0.1:3218
```

This runner defaults to the Chromium bundled with the installed Python Playwright; install its browser before the first run, or pass `--executable /path/to/chromium` to select an already installed compatible browser. It also checks the early busy state in Chromium's accessibility tree and rejects hydration mismatch warnings.

The script writes JSON, screenshots, and two short recordings under
`/tmp/slax-reader-panel-feedback-evidence`; do not commit them. Holding client-entry
and component responses independently makes the two waiting stages reproducible
without relying on a particular network speed. For a manual network smoke check,
open the lab in Chrome, enable 3G and Disable cache in DevTools, choose a scenario,
and activate Analysis or Chat before startup completes. The existing `startupDelay`
query parameter can provide a longer manual observation window on a warm cache.
