# Verification

## Automated checks

- OpenSpec strict validation passed for all 195 items.
- API and contracts type checks passed. The 55 Fork domain tests and 45 layer architecture tests passed.
- A dedicated PostgreSQL fixture applied the historical migrations and the additive receipt migration. The receipt regression test used the real repository and delivery service with a captured Resend request. It exercised publication and receipt atomicity, the 503-to-success retry using the same key, replay after acceptance, viewer isolation and a later publication that must not surface the previous email.
- Web type checking passed using generated Nuxt types. The 42 focused Web tests for Fork, login continuation and login modal passed.
- Prisma and the Core DI registration were regenerated. The umbrella generation command hit a local filesystem error during Worker types cleanup. The Worker binding interface has no changes.

## Running environment

- Chromium ran the actual Web Fork component and composable in a fixture using the repository's locales, icon registry and theme styles. Checked 320px, 390px, 768px, 769px and 1120px in Chinese and English and in light, dark and e-ink. Exercised keyboard entry, progress, save success, deferred email acceptance, mail failure, copy failure and retry, panel coexistence, bookmark navigation, revisits, sign-in cancellation and continuation, and ownership. The browser fixture has a deterministic API and a simulated login boundary. The production page's complete PDF and podcast surfaces were not exercised in the browser fixture.
- The local Edge/Core HTTP and Workflow fixture exercised marked saves across three distinct sources. The captured provider accepted all three. PostgreSQL contained three sent rows, and public anonymous metadata omitted receipt state. Later portions of the broad HTTP harness timed out on the existing media path while reporting missing Vector maintenance bindings. The complete PostgreSQL integration suite also reported one existing account-deletion fixture failure for a missing Vector maintenance Workflow. The focused receipt integration and all new assertions passed.
- The running component fixture is available at http://localhost:4206/. For final human hands-on acceptance, see the dated record below.

## Review

- A Codex subagent performed the requested quick review against the repository naming, file placement, dependency and design rules. Its important findings were fixed and rechecked.
- Claude Code reported model usage as `claude-opus-5-5` for the edge-case review. Fixed border-box and safe-area spacing, continued recovery after a resumed save times out, desktop feedback dismissal, mobile focus restoration and email title handling. The final review's missing-symbol finding was closed by checking the actual page declarations for `accountGeneration`, `activePanel` and `onUserPanelChange`; the reviewed input was a diff. E-ink uses the existing global animation reset.
- Browser/API runtime outputs were kept local. No production email or deployment was triggered.
- Web and API are the affected applications. The optional shared contract fields compile away, and existing CLI, Extension and Mobile request paths do not supply the new marker or use the new viewer-only field. No packaged client version decision is required.

## Visual refinement on 2026-11-27

- The GPT-6.2 Astra pass refined the production Fork component and kept the approved flow in place. The ready action remains filled. The paper card uses a small state ribbon, and successful desktop feedback leads with the bookmarks link and adds the email line when available.
- Chromium repeated the five-width, two-locale, three-theme interaction matrix on the revised component. An additional 320px English success check verified the receipt sentence and bookmarks action fit without overlap or horizontal scrolling. At 769px the desktop popover retained the bookmarks link and receipt without a second success heading.
- Escape restored focus to the desktop action. Reduced motion and e-ink stopped the spinner animation. The three-state captures and live fixture use the production Vue component with deterministic save and email responses.
- The revised component compiled, both locale files parsed, Web type checking passed and strict OpenSpec validation passed all 195 items. The parallel Nuxt suite run timed out in setup. A serial rerun of the targeted Fork suite with an extended setup timeout passed all 14 tests.

## Motion and spacing refinement

- GPT-6.2 Astra refined the Web component after reviewing the native Continue Reading banner. Additional references were [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion) and the [Material standard bottom sheet](https://developer.android.com/reference/kotlin/androidx/compose/material3/BottomSheetScaffold.composable).
- Chromium sampled intermediate mobile entrance and exit frames and verified both position and opacity change. The leaving dock became inert immediately. The background gradient stayed pointer-transparent and the card passed a 24px simulated bottom safe-area check.
- The narrow English success card fit at 320px with separate text and CTA regions. The painted loading circle had at least 5px of clearance on each side. The desktop popover measured a 13.5px settled gap under the header rule and Escape restored focus to the save action.
- The five-width, two-locale, three-theme browser matrix passed. Reduced motion and e-ink suppressed the spinner animation. Web type checking and the 14-test Fork suite passed. Human hands-on acceptance of this revision is pending.

## Gradient, artwork and desktop layout refinement

- GPT-6.2 Astra designed the overlapping paper artwork and the new desktop action and confirmation layout. The desktop result keeps the receipt in the summary and gives the bookmarks link a separate row.
- Chromium captured the same article at the same scroll position with the previous fade and the current fade. A paint probe 35px above the card was unchanged by the previous gradient and visibly mixed with the reader background in the current one. The reader layout reserves the full fade reach for scrolling clear of the dock. The browser fixture also verified the last paragraph could reach the clear region.
- The five-width, two-locale, three-theme interaction matrix passed. The narrow English receipt and action fit at 320px. The desktop popover retained the header gap and Escape restored focus. Web type checking and the 14 focused Fork tests passed.

## Bookmark icon refinement

- Chromium rendered the folded bookmark variant in the production Vue component fixture. It captured ready, working and saved at a 390px viewport, including dark and e-ink confirmation. The illustration remains decorative and fits its viewBox.
- The 32px icon and English receipt fit at 320px. The spinner ran with standard motion and stopped under reduced motion and e-ink. The same run rechecked the mobile dock motion and safe area and the desktop popover gap and Escape focus.
- Web type checking, the 14 focused Fork tests and strict OpenSpec validation for all 195 items passed.

## Backdrop visibility refinement

- Chromium rendered the mobile component at the same 390px viewport and scroll position with the previous fade, the revised fade and the backdrop disabled. Pixel sampling confirmed the revised gradient begins affecting text in the 28px band above the previous reach. The backdrop remained pointer-transparent, used the dark reading background and was absent on desktop and in e-ink.
- The mobile interaction run verified the 24px simulated safe area, dock entrance and exit, focus, and the narrow English success state. Web type checking, the 14 focused Fork tests, and strict OpenSpec validation for all 195 items passed.

## Final human hands-on acceptance

- On 2026-11-27, the change requester confirmed in the Codex chat that they clicked the save action, saw the success feedback in the running Web component preview, and accepted the current result. The accepted revision includes the folded-corner bookmark and the longer mobile backdrop that makes the background fade visible.

## Pre-push verification

- The final Bugs, Security and Compliance review followed `REVIEW.md`. It identified that account revocation left Fork receipt rows behind. The existing account transaction now removes them. A red/green account test and the PostgreSQL regression cover this path. The review also prompted direct assertions for both receipt locales, title-free wording and accounts without a deliverable address.
- API and contracts type checks passed. Focused API suites passed 150 tests. A disposable PostgreSQL database applied all 61 migrations and passed all 72 Fork publication and account revocation tests. The account-deletion integration fixture now supplies the existing Vector maintenance binding.
- Web type checking passed and 121 Fork, authentication and modal tests passed. Strict OpenSpec validation and the icon registry check passed.
- Claude Code reported `claude-opus-5-5` for the final edge-case review. Its confirmed issue was an unprompted failure message when opening a source with a previously failed same-URL copy. The component now opens failure feedback only for the current attempt or an explicit error. Chromium exercised the normal entry, a fresh failure and successful retry at 390px and 1120px.
- Both viewer status and pending delivery reads now use the same cache bypass as the existing receipt status query. This follows the documented Hyperdrive behavior for stable SQL expressions. PostgreSQL verified state transitions and revocation with the final queries. [Cloudflare Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- The same mock article at 1120px and 390px supplied the key visual captures for the PR. The desktop before image renders the target branch's Fork action in the same fixture. The mobile images cover the final ready state with the expanded backdrop and the saved state after simulated provider acceptance.
