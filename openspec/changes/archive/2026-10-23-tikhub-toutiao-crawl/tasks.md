# Tasks

## 1. URL compatibility

- [x] 1.1 Add the shared structural Toutiao URL utility and article route; verify supported desktop/mobile paths, tracking-parameter removal, exact host checks, unsupported paths, and unchanged string IDs in URL and platform-detector tests.
- [x] 1.2 Add the dedicated share resolver and integrate it without altering other platforms' resolver behavior; verify absolute/relative redirects, allowed destinations, request timeouts, five-hop bounds, loops, challenge pages, and absence of TikHub authorization in mocked redirect tests.

## 2. Provider capture and article documents

- [x] 2.1 Add narrow Toutiao response types and the Web API adapter using `aweme_id`; verify nested provider success, valid body extraction, missing credentials, HTTP/provider failures, malformed data, metadata-only/deleted-content rejection, and safe error output in adapter tests.
- [x] 2.2 Build the normalized article document and metadata mapping; verify title/author escaping, paragraphs and images, publication timestamps in seconds, invalid-date fallback, and removal of executable markup in document tests.

## 3. Bookmark integration

- [x] 3.1 Wire the shared capture logic into `CrawlService` and `CrawlWorkflow` with parsing/saving in the fetch step; verify body/text persistence, retained metadata, normal article validation/post-processing, and failure status without generic-provider fallback in service/workflow tests.
- [x] 3.2 Regenerate required backend artifacts with `pnpm api -- gen:all` using operator-provided configuration; inspect the generated diff and verify that no unrelated registration or runtime configuration changes are introduced.

## 4. Standalone local use

- [x] 4.1 Add `pnpm api -- debug:toutiao <url> [--output <directory>]` using the shared resolver/adapter; verify ignored repository-root output paths, normalized JSON/HTML/text files, compact summaries, nonzero failure exits, and operation without Workers or databases.
- [x] 4.2 Add `docs/TOUTIAO-CAPTURE.md` with root-command usage, fish variable export, artifact locations, supported URL forms, and deliberate billable live validation; verify its commands match the actual package scripts and do not read or copy secret files.

## 5. Acceptance and review

- [x] 5.1 Run the shared local command on the verified normal article and a real Toutiao short-link sample; inspect the resulting title, author, publication time, body, images, and canonical ID, and record outcomes in the change's verification notes without claiming an untested share format works.
- [x] 5.2 Run focused URL/provider/document/service/workflow tests, `pnpm api -- typecheck`, and `openspec validate --all --strict`; verify affected non-Toutiao route coverage still passes and record command outcomes.
- [x] 5.3 Run the Bugs, Security, and Compliance pre-push review defined in `REVIEW.md` against `tikhub-toutiao-crawl`; resolve all Important findings and record the review before any push or PR suggestion.
