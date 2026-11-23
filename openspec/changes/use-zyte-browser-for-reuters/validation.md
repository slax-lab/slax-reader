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

A second review identified misleading failure telemetry for recovered pages. The initial notice now defers the parsing failure event while the browser fetch and parse report their actual outcomes. One regression asserts two successful fetch events, one successful parse and no failed event. Additional cases cover a fallback HTTP 403 with readable text, a fallback error with only a notice (logged as `source_error`), and image-only browser results using either `src` or `data-src` without alt text. All 191 affected workflow, capture and architecture tests passed, and the Chrome exercise passed again.

## Parent task t105556 — combined source replay

- **CAC (t105557).** Retrieved the [reported source page](https://www.cac.gov.cn/2025-09/15/c_1759583017717009.htm) over HTTP (200). The raw response included the correction iframe. The original saved snapshot additionally contained the date picker. Both inputs ran through regular parsing, candidate selection and snapshot publication. Read-back HTML contained zero iframes in both cases. The 96 normalized nonempty paragraphs matched the old snapshot in order, including the last provision. In local Chrome at 390 and 1,280 CSS pixels, the reader's iframe processor gave the old snapshot two visible frames and the corrected snapshot zero. These browser checks used a simulated frame access denial.
- **X Article (t105581).** Retrieved the public FxTwitter embed and structured reference for the [original status](https://x.com/thorstenball/status/2114386050638336082) (both HTTP 200). The previous bookmark used the author as its title and included the closing profile. The combined implementation published “How I work with Agents”, retained all 16 source blocks in order in plain text, one cover and 15 bold spans in HTML, and omitted thread links, engagement counts and the provider profile. The capture used one embed and made zero structured article API requests. The local service binding served the fresh public embed, and tweet discovery received public status metadata through a local adapter. The deployed private Worker binding and authenticated tweet API were outside this exercise.
- **Reuters (t105601).** Replayed the original article's live Zyte browser response described above through regular fetch, parsing and local snapshot publication. All 25 publisher paragraphs remained in order in HTML and plain text. The 5,680-character saved text was byte-identical to the original live exercise. The local Chrome workflow also repeated the successful and persistent JavaScript-notice cases and recorded one browser request in each.
- The exercises used the application's snapshot service and a local filesystem-backed bucket. No production database, bookmark or historical snapshot was updated.

The full API suite passed 4,513 tests, with 166 skipped including opt-in database integrations. The four focused workflow, article, parser and architecture suites passed 211 tests. TypeScript, changed-file formatting, generated-code drift and strict OpenSpec validation (168 items) passed. ESLint on the changed source files reported zero errors and one existing warning in the crawl workflow.

Two review regressions cover the notice telemetry. A persistent notice records its normalized length as `noticeTextLength`. When the initial Zyte browser returns 503 and the raw fallback supplies a notice with target HTTP 200, the running workflow logged `browser_unavailable`, made no additional browser request and wrote zero snapshots.
