# Validation

## Scope

Base: `origin/dev` at `0d54ca74`, branch `fix/deferred-reader-takeover`. Web only; no API, contract, Extension, or Mobile change. Web carries no package version.

## Automated evidence

| Check | Result |
| --- | --- |
| `pnpm web -- test` (full Vitest) | 273 files passed, 1 skipped; 3,358 tests passed, 3 skipped. |
| Web `typecheck` (`nuxt prepare` + `vue-tsc --noEmit`) | Passed. |
| ESLint on changed files | 0 errors. One existing `no-explicit-any` warning in an older mock in `useReadingPosition.spec.ts`. |
| `openspec validate --all --strict` | 165 passed, 0 failed. |
| New tests that fail on the old code | The trailing-slash bridge case in `powersync-deferred-startup.spec.ts` fails with the previous exact-path check and passes with the fix. |

## Running environment

Everything ran locally against a real backend, without the test environment:

- API: `pnpm api -- dev` (Core Worker on `localhost:8787`, PostgreSQL and PowerSync in local Docker containers on ports 15432 and 18080).
- Web: a production-mode build (`node ./config/nuxt-command.mjs build` with the local `.env.web`) served by `wrangler pages dev` with `--service BACKEND=reader-backend-dev#ContentEntry --r2 OSS=slax-reader-backend`. Plain `ssr:dev` does not load these bindings and returns 500 for article pages.
- Account: a local test account signed in through the email-link flow; two local bookmarks of MDN pages.
- Browser: Chrome through DevTools in an isolated profile.
- Slow local startup was simulated with an init script that delays `MessagePort.prototype.postMessage` (the PowerSync worker channel) for 4–12 seconds after load.

Every finding was run on the unfixed `origin/dev` build first, then on the fixed build, with the same steps.

| Finding | Steps | Old code | Fixed code |
| --- | --- | --- | --- |
| P1 late switch loses the reading position | Saved position 0.35 (`local_reading_state`), local startup delayed 4 s, open `/b/[id]`, then navigate to another article. | Database ready at 4,106 ms; `scrollY` stays 0 (max 5,908). After leaving, the saved row is deleted (0 rows). | Database ready at 4,106 ms; `scrollY` jumps from 0 to 2,068 (0.35) at 4,232 ms and stays. Saved percent remains 0.35. |
| H1 REST-phase highlight disappears at hand-over | Local startup delayed 12 s; select text and click 划线 while still on REST; sample distinct `slax-mark[data-uuid]` every 30 ms. | Mark created at 10,892 ms; database ready at 12,101 ms; count drops to 0 at 12,211 ms and returns at 12,332 ms (about 120 ms gap). | Mark created at 11,550 ms before ready; count stays 1 through hand-over. Marking the row deleted in the local database then removed it from the page, confirming the page had switched to local data. |
| N1 Back does nothing after reloading an article | Open `/bookmarks`, client-navigate to the article, reload (document is deferred), `history.back()`. | After 3 s still on the article, same document (marker set before Back still present). | Lands on `/bookmarks` as a new document (marker gone), list rendered, saved position untouched. |
| P3 top-level bridge starts sync | Open `/x/ext-bridge` and `/x/ext-bridge/` as top-level pages. | Found on `origin/dev` in the earlier test-environment pass; not rebuilt locally. Locally, the first fixed build, which only checked the exact path, still started PowerSync on `/x/ext-bridge/` (`database ready`, `sync connect`), which led to the trailing-slash fix. | Both paths: `$powersync` is null, no `[powersync]` log, no sync, token, or `18080` request in the network log. |
| N3 trailing-slash bridge lacks CSP | `curl -I` both paths on the built site. | Found missing on `origin/dev` in the earlier test-environment pass; the old route rules have no `/x/ext-bridge/` entry. | Both return `content-security-policy: frame-ancestors chrome-extension://<configured id>`. |

### Extension bridge still starts sync when framed by the extension

The P3 change only refuses a top-level bridge page, so the Extension's first bridge load was checked with a real Extension. The development Extension (`wxt build`, local addresses passed as environment variables, the repository's offscreen-test instrumentation for a read-only `debug-state` message) was loaded unpacked into a fresh Chrome profile through Playwright. Its development key yields the ID `jgaccepfhchlnpggghoodnklcfcbhhlh`, which matches the `frame-ancestors` value of the local Web build. The script signed in through the local email link, read from the API log.

| Check | Result |
| --- | --- |
| After sign-in, before any Extension call | The background had already created `offscreen.html` and its iframe `http://localhost:3000/x/ext-bridge#c=<extension id>`. |
| First lookup (`query-bookmark-change` for the MDN URL) | Returned the bookmark from the bridge, `bridgeReady: true`. |
| Bridge `status` | `state: synced`, `connected: true`, `hasSynced: true`, `hasBookmarkTable: true`. |
| Offscreen `debug-state` | `state: ready`, one mount, iframe generation 1, no transport failures. |

Test data created during the run (two highlights on the local bookmark) was marked deleted afterwards; 0 live highlights remain on it.

## Not verified

- Extension writes through the bridge (create or delete a mark) after this change; only startup, status, and lookup were exercised.
- Real browser background throttling and a second account on the same browser.
- The exact production trigger timing on slow devices; the delays above are simulated at the worker channel.

## Human acceptance

On 2026-11-23 the change requester reviewed these results and the local build at `http://localhost:3000` (signed in as the local test account), and approved opening the pull request. No adjustments were requested.
