# Validation

## Automated checks

- API regression tests failed before the repair for the omitted model and the plain-text success payload. The focused API suite passed after both repairs (11 tests across the search tool, chat prompts, and chat stream handler).
- The Web stream parser and both panel tests reproduced the false completion and stale English pending text before the repair. All 135 focused Web tests passed after the repair. The full Web suite passed 3,366 tests and skipped three.
- API generation and API and Web type checks passed. The full API test run passed 4,516 tests after rebasing onto `3ff1b2e1` and skipped 166. API lint completed with warnings and no errors. All five Workers built with Wrangler dry-run.
- Targeted Web lint reported three import-order errors. Running ESLint against the corresponding target-branch files reproduced each error at the same line.
- The three focused Extension Chat suites passed all eight tests. The change uses the existing nullable content field, which the shipped Extension already handles.
- The OpenSpec change and repository-wide strict validation passed.

## Running environment

- A production reproduction on November 24, 2026 used the same public article as the report. The browser captured `processing` and `finished_failed` for the search tool at 08:32:49 China Standard Time, followed by the chat's `completed` event at 08:32:51. The matching Cloudflare event identified the current `reader-ai` version `f70a266a`. The [production source](https://github.com/slax-lab/slax-reader/blob/5459cf19d5d4d9ac58be9f1673cab647a105fa66/apps/api/src/domain/aigc.ts#L119-L150) omits `model` in the search call. The original November 21 invocation has a tool-start log, but its caught exception was unavailable.
- The repaired search tool and pinned Google SDK sent two real HTTP requests to a loopback provider fixture, each using `gemini-3-flash-preview` and the `googleSearch` tool. The success response returned its summary to Chat and emitted `finished_successfully` with null tool content. The error response emitted `finished_failed`.
- A local HTTP exercise sent requests to the actual Chat controller, search tool, and pinned Google SDK. With the production search method restored for the control, the SDK made zero search HTTP requests, returned the missing-model error to Chat, and emitted `finished_failed`. The repaired method made one search request in each scenario. A loopback HTTP 200 produced `finished_successfully`, and an HTTP 403 produced `finished_failed`. The outer Chat stream completed in all three cases. A browser run against that same local HTTP endpoint verified the raw event stream and the corresponding visible Chinese search label for each case.
- A local Nuxt page mounted the actual Web snapshot and reader chat panels and drove their normal HTTP stream handling. The pending indicator resolved to the localized failure label for both panels in English and Simplified Chinese, in light, dark, and e-ink, and at 320, 768, and 1200 px. Both panels rendered a subsequent assistant reply on the successful-search stream.
- The before and after captures show the same failed-search fixture, site language, light theme, and 1200 px viewport. The before browser restored the target branch's exact search-tip expressions and event status mapping in the served modules. The after browser used the working tree's modules.
- The repaired version used synthetic provider configuration. Live Vertex AI grounding and verification of the repaired version in a release environment remain open. The native Extension UI and authenticated local Web integrations were outside the exercised fixture.

## Human hands-on acceptance

On November 24, 2026, the change requester reviewed the running local Web acceptance page and confirmed that the interface matched expectations. The preview used the actual local Chat endpoint and a loopback provider fixture. The requester asked for no adjustments.
