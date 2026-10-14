## Context

The legacy fix extracts the browser-host list from `CrawlService.fetchRegular` and adds DXY. DXY remains a regular URL, because the dedicated WeChat route only serves `mp.weixin.qq.com`. Its source shell contains an empty `#j_article` and loading/dialog elements; a parser can select those instead of article content.

## Decisions

Port the existing fix into `apps/api`, preserving monorepo imports and surrounding logic. Both Zyte and ScrapingBot receive the same browser-rendering flag and unchanged URL, including query parameters. Match configured hosts and dot-delimited subdomains; unrelated suffixes do not qualify.

After regular parser selection, reject a result only when its title is blank and its short, normalized text consists entirely of the known placeholder vocabulary. Throw before the R2 and database success writes, allowing the existing workflow retry and failure handling to apply. Dedicated platform parsing is unchanged. Keep normal untitled prose and titled short content valid.

## Limits and Risks

Browser rendering depends on provider availability and the origin's JavaScript completing. The guard recognizes a narrow vocabulary; it does not detect every incomplete page. It does not invalidate existing successful cached bookmarks. No deployment or data backfill is included.

## Validation

Use the original shell regression with real parsers and mocked storage boundaries; verify no successful writes occur. Verify provider requests, fallback, query preservation, ordinary article saves, and negative placeholder cases. Run the API test suite, lint, typecheck, generated-code commands, OpenSpec validation, and the three-pass pre-push review in `REVIEW.md`.
