# Verification on November 23, 2026

## Live capture

The API's regular fetch and save methods processed the [article from Feishu task t105601](https://www.reuters.com/world/china/china-ai-bubble-has-already-burst-2026-10-26/). A direct HTTP request returned 401 with the known JavaScript notice. The updated fetcher sent the same URL to Zyte's extract endpoint with `browserHtml: true` and `javascript: true`. Zyte returned HTTP 200 and reported HTTP 200 for the target. Its final URL matched the submitted URL.

The article parser, media snapshot service and snapshot bundle writer ran locally. A filesystem-backed test bucket received the HTML and plain text and a local repository adapter recorded the successful publication. Reading the saved files back yielded the title “In China, the AI bubble has already burst” and 5,680 characters of text. All 25 Reuters paragraphs tagged `paragraph-0` through `paragraph-24` appeared in the saved HTML in their original order and in the plain text. The comparison collapsed whitespace and removed zero-width spacing characters. The saved HTML contained 26 paragraphs including the closing credits.

The external Zyte request was live. This exercise did not deploy the changes or update the existing production bookmark.

## Regression checks

- `pnpm api -- test test/domain/crawlContent.test.ts test/infra/remoteFetcher.test.ts test/flow/addUrl test/flow/import/importDynamicFallback.test.ts test/script/layerArchitecture.test.ts` passed all 431 tests across 21 files. The Reuters cases cover the exact request payload for both supported hosts, unrelated URLs, fallback request mode, body persistence, tracking pixels, articles quoting the notice, publisher-supplied HTML and workflow failure before post-processing.
- `pnpm --filter slax-reader-backend exec tsc --noEmit` and ESLint on the changed API source files passed. Prettier checks on both changed source and test files and `git diff --check` passed.
- `pnpm api -- gen:all` ran using the public configuration template and local placeholder database URLs. The generated files matched the checkout.
- `openspec validate --all --strict` passed all 165 items.

## JavaScript notice recovery

The previous implementation wrote “Please enable JavaScript to read this story.” as a successful plain-text snapshot from a raw response. A local HTTP newsroom fixture served that notice, then replaced it with an article when JavaScript ran. The modified capture workflow made one raw request and one browser request. Headless Chrome rendered the fixture, the workflow wrote the article once to local storage and post-processing ran. On a second page that retained the notice in Chrome, the workflow made the same two requests, wrote zero snapshots and skipped post-processing. The provider transport was local for these two exercises. Replaying the previously captured live Reuters response through the updated parser produced the same 5,680-character text, byte for byte.

Worker logs use the event name `capture_js_notice`. The smoke run observed `retry_started` followed by `recovered` or `still_notice`. Tests also exercised `retry_failed` and `already_rendered`, checked the 120/121-character boundary, and verified that the event payload omits the article text and URL query. The workflow checkpoints the detected notice before a browser step with automatic retries disabled.

The notice check also handles zero-width spaces and excludes a publisher logo from the editorial-media exception. Regression tests cover both initial PR review comments.

The full API suite passed 4,502 tests and skipped 166, including opt-in database integration tests. After adding a prefixed “enable JS to continue” case, the five focused suites passed all 208 tests. TypeScript, formatting and the layer architecture checks passed. ESLint reported zero errors and two warnings on existing lines. Backend generation produced no tracked drift. Strict OpenSpec validation passed all 168 items.
