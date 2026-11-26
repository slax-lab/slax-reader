# Verification

## Agent checks on 2026-11-25

A Chrome component run exercised guest Save, modal dismissal, a later explicit save, a failed admission and deliberate retry. The request was observed at the existing add_url boundary. The Nuxt OAuth callback ran in a second tab after closing the initiating tab. It persisted a synthetic session, admitted the source UUID once and returned to a synthetic readable article at the same URL. Replaying the callback did not send a second admission. The signed-in route middleware routed the replay to Inbox.

In the integrated Nuxt app the actual email-code form issued a challenge on the save login modal. Chrome then opened its matching email sign-in link in a new tab after closing the original tab. That link admitted exactly the intended source and returned to the article. The challenge, mail proof and write service were synthetic.

The focused bookmark-fork, email-link, OAuth callback, login modal and login view suites passed 98 tests. They cover unrelated and cancelled attempts, single consumption, email challenge binding, failures, signed-in metadata and replay. Provider responses, article storage and the admitted copy were fixtures. Live Google, Apple, mail delivery, passkey hardware and production Inbox replication were not exercised.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
