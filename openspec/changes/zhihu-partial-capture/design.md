# Design

## Context

See proposal.md for motivation and specs/zhihu-capture/spec.md for observable behavior. `SocialMediaApi.fetchZhihuByUrl` currently combines routing, provider calls, and HTML assembly. Question capture rejects the entire `Promise.all` when either endpoint fails. The shared TikHub transport logs raw error bodies and throws an error without structured status information.

`CrawlService.fetchZhihuData` returns `{ title, content, author }`. `parseAndSaveZhihu` already normalizes lazy images and uses the social-media save path. The surrounding workflow's fetch step retries twice at one-minute intervals; its failure handler marks capture failed, sends alerts, and updates import accounting. Existing workflow tests cover the Zhihu route but not provider retry/partial-response combinations.

The November 14 investigation found that an article and a pin sample succeeded while an answer still failed after 1/2/4-second backoff. This supports bounded independent recovery, not an assumption that retrying always fixes upstream failures.

## Goals / Non-Goals

**Goals:** keep successful parts in memory during one capture execution, return the existing capture result shape, and make the local retry budget the only budget for exhausted Zhihu provider failures.

**Non-Goals:** shared provider refactoring, new database state, new rendering styles, additional pagination, automatic post-recovery enrichment, or unrelated changes in the current dirty checkout.

## Decisions

### 1. Isolate the Zhihu transport without changing other platforms

Move the existing Zhihu-specific routing and assembly into `apps/api/src/infra/external/zhihu.ts`, keeping `SocialMediaApi.fetchZhihuByUrl` as a delegating entry point. The module owns the fixed TikHub host, exact string IDs, expected response validation, request attempts, and a typed terminal no-content error. Keep the public `{ title, content, author } | null` contract and unsupported-URL behavior.

Use native fetch and already installed HTML utilities; add no dependency. A localized transport is preferable to changing shared `fetchTikHub`, because status-aware retries and safe diagnostics must not alter billing, timing, logging, or failure behavior for other platforms. Do not catch rendering/programming errors as transient provider failures.

### 2. Run independent bounded attempts, not whole-page retries

For question URLs, start detail and answer-list operations concurrently and settle both independently. Each operation retains its first valid response and never runs again because its sibling fails. Preserve `limit=20, offset=0` and the current endpoint paths. Single-answer, article, and pin captures use the same request helper for their one endpoint.

Each endpoint has four attempts total, with delays of 1, 2, and 4 seconds. Each attempt uses a 20-second abort deadline covering both fetch and body reading. Retry transport failures, deadlines, malformed envelopes/JSON, HTTP 408/5xx, and the generic TikHub upstream HTTP 400 documented by ticket 1324 and observed in this investigation. An HTTP-success envelope with a recognized transient provider code follows the same classification. Explicit invalid-parameter or not-found errors, HTTP/provider 401/402/403/404/422/429, and other unclassified non-transient failures stop that part immediately; never apply the generic-400 exception to another platform. Do not infer retryability by logging or exposing untrusted error text.

A valid response with an empty answer array or missing optional description is settled, not repeatedly polled for more content. A structurally invalid response is a failed attempt. At most four 20-second attempts plus seven seconds of waits are spent per endpoint; concurrent question parts finish within the existing five-minute fetch budget. No polling loop or additional workflow step is introduced.

### 3. Assemble only usable body parts

Retain available detail metadata even if its description is empty. Append a usable description first, then usable answers in provider order, using the existing answer-card HTML and metadata escaping. For an answers-only capture, choose the title from the first retained answer with a nonblank question title; otherwise use the neutral label `知乎问题`. Never invent an author or description. Preserve the existing `知乎回答` byline and question container markers.

Check body usability before wrapping the content with a title or author UI: HTML must contain non-whitespace readable text outside non-content elements, or media already supported by the existing pipeline with a usable source. Use existing linkedom parsing rather than tag-stripping regexes; recognize the lazy image source attributes already normalized by `parseAndSaveZhihu`. Empty markup, metadata, or an h1 added by our builder does not qualify. Filter invalid answer entries and unusable pin blocks individually. A successful response with no usable body is omitted without consuming further retry attempts.

Single-answer URLs remain single-answer captures. Do not fetch other answers as substitutes, add more pages, or treat a question title as the requested answer body. If all assembled body parts are empty or unavailable, throw the typed Zhihu no-content error with sanitized diagnostic context. Return normal partial results through the existing save path; no new partial-state field or article banner is added.

### 4. Stop outer retries after the Zhihu budget is settled

In the workflow's `case 'zhihu'`, convert only the typed terminal error to `NonRetryableError` after `trackStep` records the failure. Use a recognizable `zhihu_capture_unavailable:` prefix. Keep database errors, unexpected programming errors, and other platform behavior on their existing paths.

The existing outer catch still marks capture failed, alerts, and updates import accounting. Classify the Zhihu unavailable prefix as `workflow_fetch.exhausted` rather than mislabeling an upstream outage as a business-policy rejection; other NonRetryableError classifications remain unchanged. This avoids multiplying four local attempts into twelve and prevents re-requesting metadata-only successful parts when there is no publishable body.

A partial result is an ordinary successful fetch step and proceeds to parsing and post-processing. Later parsing failures do not invalidate the completed fetch step. No durable memoization is added for unexpected process loss or operator-triggered new captures.

### 5. Keep diagnostic data bounded and safe

For each exhausted/omitted part, log an allowlisted summary containing endpoint path, attempt count, HTTP status, provider code, request ID, and a locally chosen reason such as timeout, malformed response, or empty body. Bound provider identifiers before logging. Do not log token-bearing headers, full URLs, arbitrary provider message strings, raw bodies, or serialized response objects. The aggregate error includes only safe component summaries; the provider's existing request ID remains available for support.

## Risks / Trade-offs

- Partial snapshots lack some original content -> this is the requested behavior; retain source attribution and do not imply missing content was fetched. There is no automatic enrichment after provider recovery.
- Missing detail title when only answers survive -> use an available answer's question title or the neutral fallback, without discarding its body.
- Faster retries cannot restore a continuously failing endpoint -> stop at the explicit budget and omit it, rather than promising recovery.
- Retrying failed provider calls can cost time, and provider billing policy can change -> bound attempts/time and never repeat an already successful part within the same execution.
- Rate-limit/authentication failures are not transient content failures -> stop that part immediately instead of escalating traffic; a separately successful part still survives.
- Parser changes could reject valid short or image-only bodies -> add text, whitespace-only, lazy-image, and image-only cases without a minimum text-length threshold.
- The checkout contains unrelated unfinished work -> planning artifacts are isolated; implementation must move this change to its own `fix/zhihu-partial-capture` branch from `origin/dev`, without stashing or overwriting unrelated files.

## Verification

- Add adapter tests in `apps/api/test/infra/zhihuCapture.test.ts` using mocked native fetch and fake timers: all-success, each partial direction, recovery, exhaustion, terminal statuses, invalid envelopes, valid-empty responses, malformed entries, exact large IDs, image-only bodies, and redacted diagnostics. Assert endpoint-specific call counts and that success is never re-requested.
- Extend `apps/api/test/flow/addUrl/10-crawlWorkflowRun.test.ts` for partial save/post-processing and typed terminal failure. Verify failure state, alert classification, import accounting, no success publication, and unchanged non-Zhihu behavior.
- Run the focused tests, API typecheck/lint, and full API suite. Exercise actual local save/read flows in a running environment with controlled provider failures and record request counts plus persisted body results in `validation.md`; clearly identify any test double or unverified boundary. Live TikHub samples can supplement but not replace deterministic cases.
- Human hands-on acceptance of the resulting reader content is required before a PR, because saved content is user-visible. No new UI design or layout is proposed. Follow `REVIEW.md` before any eventual push.

## Migration Plan

No schema or data migration. After human proposal approval, implement on the dedicated branch and complete the checks above. Deployment requires a separate explicit request. Existing snapshots are unchanged; new captures or user-requested retries use the revised behavior. Rollback reverts the adapter/workflow change and does not rewrite saved content.

## Assumptions

- “Use whatever is available” permits omitting failed parts, but not saving a metadata-only empty article.
- The scope is the current first-page content, not pagination or fallback-provider selection.
- A requested answer must stay that answer; a failed single-content capture remains failed if no body survives.
- No application package version bump is expected for the API-only implementation unless its eventual diff reaches shipped client behavior or package output.
