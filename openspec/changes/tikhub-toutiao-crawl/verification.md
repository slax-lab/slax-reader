# Implementation Verification

## Scope and approval

- Date: October 8, 2026, Asia/Shanghai.
- Change: `tikhub-toutiao-crawl`; branch: `feat/tikhub-toutiao-crawl`, based on `origin/dev` in its own managed worktree.
- The user reviewed the curl findings, supplied a real short link, and authorized implementation of the tested approach. The implementation includes the discussed explicit failure behavior for expired links and deleted-content placeholders.
- All durable documentation and new comments are in English. No frontend, schema, credential, or public API contract changes were made.

## Curl discovery

Requests used the user's existing fish `TIKHUB_TOKEN`, exported only to child processes. Authorization was passed to curl through stdin configuration, without printing the token or placing it in argv. No secret configuration file was read or copied.

The live OpenAPI schema confirmed `aweme_id` for the Web article endpoint and `group_id` for the App endpoint. The Web response had outer `code: 200`, inner `message: success`, and body at `data.data.content`. The tested App responses had metadata without an article body and are not runtime fallbacks. A direct public article page returned a JavaScript challenge rather than usable content.

HEAD and GET both resolved the user's `https://m.toutiao.com/is/CI_XBMsL7IU/` to article `7694114872820384290`. The runtime resolver uses bounded GET redirects and stops at an article URL without requesting its challenged page.

| Short link | Discovery result |
| --- | --- |
| `m.toutiao.com/is/CI_XBMsL7IU/` | Redirected to a complete article; Web API supplied the body |
| `m.toutiao.com/is/SHeNRtol4oI/` | HTTP 200 without a redirect; expired-link response |
| `m.toutiao.com/is/qh1NE90cCvs/` | HTTP 200 without a redirect; expired-link response |
| `m.toutiao.com/is/nEsX_N-lL4I/` | Redirected to article `7693552185916916253`; Web API reported success but returned `delete: 1` and a deleted-content placeholder |

Live compatibility is established for the tested `m.toutiao.com/is/` format. The other supported share hosts have mocked coverage, not live acceptance claims.

## Standalone live acceptance

Executed from the worktree root with the existing fish variable:

```sh
fish -lc 'set -gx TIKHUB_TOKEN $TIKHUB_TOKEN; pnpm api -- debug:toutiao https://www.toutiao.com/article/7450114952884503059/'
fish -lc 'set -gx TIKHUB_TOKEN $TIKHUB_TOKEN; pnpm api -- debug:toutiao https://m.toutiao.com/is/CI_XBMsL7IU/'
```

Both commands exited successfully without starting Workers or connecting to databases. Each wrote normalized `capture.json`, sanitized `article.html`, and `article.txt` under repository-root `.local/toutiao-capture/<article-id>/`.

| Captured article | Author | Publication time (UTC) | Readable body characters | Paragraphs / images / links |
| --- | --- | --- | --- | --- |
| `7450114952884503059` | Shandian News | `2024-12-19T13:31:15.000Z` | 1,249 | 8 / 1 / 4 |
| `7694114872820384290` | Jiewei Guancha | `2026-10-08T02:26:10.000Z` | 2,502 | 60 / 1 / 20 |

Titles, original author names, canonical string IDs, publication timestamps, paragraphs, links, and images were inspected in the local artifacts. No script elements or event-handler attributes remained. Character counts include paragraph separators; they differ from the discovery probe's concatenated text counts.

The standalone command also exited with status 1 for a missing token and for the expired `SHeNRtol4oI` share link. The latter did not make a TikHub article request. Deleted flags and placeholders are covered by deterministic provider tests using the discovered response shape.

## Saving the live bodies offline

An additional isolated check passed the captured documents through the actual `CrawlService.parseAndSaveToutiao()` with in-memory storage/repository doubles and a Node MD5 compatibility shim for the existing Workers image signer. It made no provider or database requests.

| Article | Saved paragraphs | Saved images | Images routed through existing proxy signer | Body text retained exactly |
| --- | --- | --- | --- | --- |
| `7450114952884503059` | 8 | 1 | 1 | Yes |
| `7694114872820384290` | 60 | 1 | 1 | Yes |

Generic article extraction was first checked against these documents and removed both lead images and changed paragraph structure. The dedicated save path therefore parses the already sanitized provider fragment directly into the existing `Preparse` shape, with authoritative metadata, current-time fallback for missing publication metadata, image replacement, quality scoring, R2/database persistence, and normal workflow validation/post-processing. A regression test covers a lead image and sixty short paragraphs.

## Automated validation

Passed:

```sh
pnpm api -- test test/utils/toutiao.test.ts test/script/toutiaoCapture.test.ts test/flow/addUrl/15-toutiaoCapture.test.ts test/flow/addUrl/10-crawlWorkflowRun.test.ts test/utils/platformDetector.test.ts test/flow/addUrl/5-crawlRouting.test.ts test/flow/addUrl/14-twitterArticleCapture.test.ts
pnpm api -- typecheck
pnpm exec openspec validate --all --strict
```

- Seven test files, 172 tests passed. Coverage includes structural URLs/string IDs, absolute and relative redirects, five-hop bounds, loops, timeouts, unsupported/private destinations, absence of share authorization, missing credentials, HTTP/provider/JSON/body failures, deletion checks, metadata escaping, executable-markup removal, timestamps, full-body persistence, workflow failures, soft-404 checks, normal validation/post-processing, standalone outputs, and existing platform/X Article routes.
- Typecheck passed after fixing the DOM attribute iteration's compatibility with the Worker type definitions.
- OpenSpec strict validation passed for all 20 items.
- ESLint passed for all changed runtime files and the standalone script: zero errors, seven existing warnings in unchanged lines of `crawlWorkflow.ts` and `socialMedia.ts`. New runtime files have no lint warnings.
- `git diff --check` passed.

Required `pnpm api -- gen:all` completed using `SLAX_API_CONFIG` pointing at the operator's existing native `api.toml`. Local placeholder PostgreSQL URLs were supplied only for Prisma client generation; no database connection or migration occurred. The worktree contains no copied secret files. Generated DI/router/runtime artifacts match the base branch, so no generated diff is needed.

## Local pre-push review

Completed the three passes in root `REVIEW.md` against the full local implementation and planning artifacts. Multiple changes are active; the diff uniquely implements `tikhub-toutiao-crawl`.

- **Bugs:** Found an Important body-fidelity issue when generic extraction removed the lead images and changed paragraph structure. Resolved by preserving the provider's normalized body directly; verified against both live capture artifacts and the lead-image/short-paragraph regression test. No unresolved Important findings.
- **Security:** Checked exact host/public-target restrictions, manual bounded redirects, credentials only at the fixed TikHub endpoint, safe failure messages without provider payload logging, token-free artifacts, escaped metadata, markup/attribute allowlists, and public HTTP(S) body URL validation. No Important findings.
- **Compliance:** Matched URL forms, Web-only body source, failure behavior, full body/metadata persistence, existing storage and post-processing, standalone root command, and documented live-sample limits to the proposal/design/delta. All eleven tasks are implemented and verified. No Important findings.

Implementation is complete locally. Remote deployment and OpenSpec archival remain outside this local experiment; archival follows merge.
