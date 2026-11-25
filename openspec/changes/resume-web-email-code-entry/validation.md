# Validation

On November 25, 2026, Chrome exercised the development application on localhost with synthetic email-send and verification HTTP responses. It used the production login page, live modal bootloader, browser session storage, timer, cookie completion and navigation.

- Opened the login page with a specific guide continuation, requested one code and typed six digits. Refresh restored the original address and the empty code input. The 40-second resend countdown showed 33 seconds remaining. The service received one send request. The stored entry contained neither the typed digits nor a login token.
- Changed address, reloaded, and started a fresh challenge. A two-second fixture expiry disabled verification and removed the challenge. Reload permitted a fresh send.
- Entered the code for the fresh challenge. One verification request completed, the app reached the original guide URL, and tab storage contained no pending challenge.
- Opened the real login modal from the guide using the app's modal entry point, requested a code, closed the modal, and reopened it with the same continuation. The empty code field returned without another send.
- The LoginView, LoginModal and email-link page suites passed, 59 tests total. The snapshot-save regression restores a challenge when the same source article reopens with a fresh continuation nonce and uses the current nonce for the return. A different article cannot restore it. The component tests also exercise a different continuation, address changes, remembered-address behavior, aborts, and passkeys. The test configuration allowed access to the shared local package store.
- The selection package build, Nuxt preparation and Web application TypeScript check passed. Strict OpenSpec validation passed for all 175 items.
- Delivery by an external mail provider and a live account were not exercised.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
