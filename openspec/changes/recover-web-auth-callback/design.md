# Design

## Context

See proposal.md for the approved scope. `auth.vue` awaits `useAuth().grantAuth()` without catching failure. The shared HTTP client already accepts a signal and per-request error interceptor, but the login composable does not expose them. Provider buttons already initiate fresh authorization and preserve a return target and referral code.

## Decisions

- Keep callback state and recovery in the page, with loading, failed, and timed-out states. Use the existing provider buttons and Web semantic tokens, localized persistent text, and an accessible error region. Simply clearing loading would render an empty page; retrying the old code would conflict with OAuth's single-use semantics.
- Apply the requester's preview feedback with an application-authored, static 32px inline SVG circled-exclamation above the recovery title, in a 56px accent-tinted circular surface. Geometry uses currentColor; the SVG is decorative, aria-hidden, and non-focusable. Existing accent/background tokens provide light/dark/e-ink paint. This small local status treatment adds no imported SVG, animation, dependency, or new interaction.
- Validate callback state once at its boundary with the existing schema dependency. Retain valid provider/return/referral context for recovery; malformed state uses the default Google entry.
- Pass optional signal/error-interceptor options through `grantAuth` to the existing HTTP request, without changing the shared request implementation. This caller handles errors in its persistent UI. Existing callers retain their default request behavior.
- Use a 20-second timer and AbortController. Timeout sets the page's recovery state directly, so it does not depend on a stalled promise settling. Clear the timer and abort pending work on disposal. Check cancellation before login-cookie persistence and before success navigation; cancellation does not undo server work.
- Handle the page's complete asynchronous callback chain, including parsing and navigation, to avoid another unhandled rejection. Preserve missing-code routing and the Android early handoff.

## Risks / Trade-offs

- A slow but valid login may exceed 20 seconds: users can restart authorization; this is the approved initial waiting limit, not a server SLA.
- Server authentication may already have consumed the code when the client fails: only a new provider authorization is offered, with no automatic code replay.
- This recovery starts after page setup: a plugin that prevents the page from mounting still needs a separate startup investigation.

## Verification

Regressions exercise real page rendering and request-option propagation: network/provider failures, pending timeout, cancellation before cookie persistence, malformed state, retry context, successful navigation, missing code, and Android handoff. A browser harness uses the actual Vue page, composable and request client with a synthetic local HTTP service for disconnect, pending, provider error and success. Verify recovery remains visible after the old toast duration, new authorization uses no old code, and themes/widths remain usable. Record commands, running evidence, limitations, and human hands-on acceptance in validation.md.

## Integration with current dev

The CI/review follow-up merges dev's collection provenance and snapshot-session recovery without replacing those behaviors. Preserve the existing fifth `grantAuth` argument for unknown collection attribution; transport options are a separate sixth argument. Callback state parses optional provenance for the typed Google button using the same accepted shape as the existing backend, ignoring malformed optional provenance rather than blocking authentication. Valid provenance is retained on both the initial exchange and a fresh Google authorization. The PowerSync snapshot-session guards from dev remain intact.
