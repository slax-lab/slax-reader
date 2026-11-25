# Validation

On November 25, 2026, Chrome exercised the local Nuxt application with synthetic accounts. The reading and authentication sites used separate sibling hosts, `reader.slax.test` and `auth.slax.test`, with a shared `slax.test` session-cookie domain. The provider redirect and API responses were local fixtures. Real pages, client session completion, account preference reads, language changes, and browser cookie scope were exercised.

- Started email sign-in in Chinese with an English account. On return, both the interface and the document language were English. The offer was rendered in Chinese with its own language attribute.
- Chose Chinese. The account-language writer sent exactly one language update, the UI switched to Chinese, and reloading did not show another offer.
- In independent browser contexts, kept English and dismissed the offer. Each case produced zero language writes, retained English, and did not repeat the offer after reload.
- A Chinese account signing in from the Chinese UI received no offer or language write.
- Started Google sign-in in Chinese on the reader host. The simulated provider redirected to the actual OAuth callback on the auth host. The callback completed the session and returned to the reader host. The Chinese offer appeared there, retaining English caused zero writes, and the offer did not repeat. The hostnames were mapped to loopback and Chrome treated the two local HTTP origins as secure for platform-feature parity.
- The focused account-store, OAuth, cold-start, locale-task, language-handoff and language-offer suites passed (six files, 124 tests). This includes a sibling-host cookie-jar regression and action, dismissal, matching-language and one-shot checks. A local Vitest file-access override allowed the shared dependency store.
- The selection package build, Nuxt preparation and Web application TypeScript check passed. Strict OpenSpec validation passed for all 175 items.
- A live OAuth provider and production account were not used.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
