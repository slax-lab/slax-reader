# Validation

## Browser exercise

On November 25, 2026, Chrome exercised the development Web application on localhost using the existing reader-startup fixture layer, two synthetic identities, and a disposable PowerSync SQLite database. The client loaded the installed SQLite WASM asset directly because the shared package store is outside the development server's file allowlist.

- Seeded a downloaded bookmark, opened the Inbox row's Edit title control, entered `Pending edit returned 1`, and committed with Enter. Held the sync response until the new title was visible. The real connector's alias PATCH received HTTP 401. The login page displayed the pending-edit notice and contained no copy of the title.
- Used the email-code login form and synthetic successful authentication to return to the original owner. The same title reappeared. The real connector retried the SQLite queue and the synthetic HTTP service accepted the exact alias. A second isolated browser context displayed `Pending edit returned 1` after receiving the accepted value as its fixture checkpoint.
- Repeated the Inbox edit as `Pending edit returned 2`, rejected its upload with HTTP 401, and signed into a different synthetic account. The previous row was absent from SQLite, and the synthetic service received no previous-owner upload for the new account.
- With a separate seeded Inbox, held uploads with HTTP 503, renamed the bookmark, invalidated the cached sync credentials, and returned HTTP 401 to the next sync-token request. Before any successful upload, the pending marker was present and the browser reached the recovery notice. The original owner signed back in and the subsequent successful upload and second independently seeded browser agreed on the exact new title.
- Only the remote auth and replication boundaries were simulated. The test controlled upload delivery and injected the synthetic service's accepted row into the second browser to model download. A deployed PowerSync stream and live accounts were not exercised.

## Automated checks

The bridge-session, useAuth, and expired-session integration suites passed, 66 tests total. The bridge-session tests cover retained batches, disconnection, anonymous startup, fresh server validation for matching and different owners, explicit discard, and a switched cookie during upload, credential rejection before upload, locally expired JWTs, and preservation of the snapshot route during in-flight metadata recovery. The existing expired-session integration suite covers both locally expired tokens and cold-start server rejection.

The selection package build, Nuxt preparation and Web application TypeScript check passed. Strict OpenSpec validation passed for all 175 items.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.

The PR branch integrates the target branch reconnect backoff and preserves its token and upload instrumentation. The final Web verification passed 571 tests across 30 suites, including the bridge session and reconnect backoff suites. Web application type checking and the changed-file lint check passed, with 62 ESLint warnings and zero errors.
