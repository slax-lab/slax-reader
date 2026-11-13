# Newsletter Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task; use superpowers:subagent-driven-development only when delegation is chosen. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved by the requesting user on 2026-10-29 for implementation in the existing worktree and renewed local acceptance. PR update remains after that acceptance.

**Goal:** Address the four review comments with one HTTP-original policy for Web, coherent Feed ordering, non-fatal resource cleanup, and bounded streaming ingestion that accepts ordinary large attachments without retaining them.

**Architecture:** Keep the separate RSS/Newsletter tables and local-first streams. Web retains its existing owned-local and non-local REST modes, with one client comparator and one ordering contract exercised against both execution paths. For ingestion, a MIME splitter discards ordinary attachment bodies and bounds retained text/CID data before the existing postal-mime parser and sanitizer; durable publication remains synchronous.

**Tech Stack:** TypeScript, Vue/Nuxt, PostgreSQL, SQLite/PowerSync, Cloudflare Workers with existing nodejs_compat_v2, postal-mime 4.1.3, and proposed pinned @zone-eu/mailsplit 5.4.29.

**Spec:** [Current design](../../../openspec/changes/support-newsletter-feed/design.md), [Newsletter delta](../../../openspec/changes/support-newsletter-feed/specs/newsletter-feed/spec.md), and [Web design contract](../../../DESIGN.md). The approved changes below must be reconciled into the existing proposal/design/spec/tasks before implementation, not treated as already approved requirements.

## Global Constraints

- Continue in the existing feat/support-newsletter-feed worktree and original PR #349, targeting dev. Do not deploy or merge.
- Preserve sr_rss_feed, sr_newsletter_feed, rss_v1, newsletter_v1, RSS writes/history/retention and existing local ownership/enablement fences. No schema or migration change is needed.
- Keep independent R2 Inbox copies, ordinary sharing defaults, permanent feed+account addresses, full-mail HTML without Readability, tracking-image filtering and signed remote images.
- Add no Workflow, raw-EML persistence, recovery loop, Newsletter cron, compatibility migration or trial-data repair.
- Only explicit HTTP(S) targets qualify as original links, matching Mobile httpOriginalUrl. Do not prepend https:// to internal identities.
- Keep the ordering key: sort_at DESC, kind DESC (RSS before Newsletter), then native ID DESC. Newsletter IDs stay decimal strings and are compared numerically without Number conversion.
- Proposed ingestion budgets are implementation choices for review: inbound raw bytes 25 MiB; retained transfer-decoded HTML 2 MiB and plain text 2 MiB independently before charset conversion; retained CID raster bytes 5 MiB total; final embedded data-URL characters 5 MiB total; retained multipart structural bytes 64 KiB. Text budgets apply in aggregate per type across the message. Existing rendered-body prefix remains 512 * 1024 characters. Text/CID excess truncates retained content rather than rejecting a small body because of an ordinary attachment; a structural-budget violation rejects the malformed/excessive structure rather than cutting a MIME delimiter.
- Preserve existing MIME depth 32, part count 200, aggregate headers 64 KiB, per-user 200 sources and 200 new messages per UTC day. These limits apply at the receiving boundary.
- Original receive/publication errors must propagate through the existing sanitized error path. Resource cleanup errors must not change the delivery outcome or replace the original error.
- Keep one privacy-safe timing summary through cleanup; five seconds remains an observation target. Never log addresses, subjects, body/attachment bytes, URLs, base64 or raw infrastructure exceptions.
- Preserve Mobile's current inherited version and its previously accepted no-additional-bump decision. This plan does not add a Mobile Newsletter feature or change Extension/CLI products.
- Project documentation and code comments are English; the user-requested Chinese Prisma field documentation stays Chinese.

## Review Focus

1. A successfully published message followed by failed disconnect remains successful; a receive failure followed by failed disconnect preserves the receive error.
2. Same-time mixed entries and IDs 9, 10 and 9223372036854775807 have identical local/server order and paginate without omissions or duplicates.
3. A small body plus an 8 MiB ordinary attachment is accepted; skipped bytes never enter retained MIME, attachment arrays or R2, and backpressure is respected.
4. CID parts before the HTML, repeated CID references, and a CID candidate exceeding its budget preserve text and valid complete retained images with an honest truncation notice.
5. One-byte chunks, MIME boundary splits, encoded text, long lines, excess headers/parts, stream errors and an incomplete input cannot silently publish a partial message as a complete success.

Each focus item is assigned to the tests in Tasks 2, 4 or 5. Existing A/B isolation, duplicate admission and independent Inbox-copy tests remain required regression coverage.

## Proposed OpenSpec Reconciliation

After the user approves this plan, revise only the existing support-newsletter-feed artifacts:

- proposal.md: record approval and the four bounded corrections; replace the claim that postal-mime is the only additional dependency with the justified splitter dependency.
- design.md and specs/newsletter-feed/spec.md: replace the 5 MiB raw-mail policy with 25 MiB bounded streaming input, independent retained-content budgets and ordinary-attachment discard; specify the HTTP-only original policy, common ordering examples and non-fatal cleanup diagnostics.
- tasks.md: add unchecked tasks for these corrections before the existing archive-after-merge item. Do not reopen already accepted unrelated work or mark new tasks complete before evidence exists.
- validation.md: append new evidence; retain earlier results as revision-scoped history. Update NEWSLETTER-DEV-PILOT.md at delivery to describe the new size policy and log field.

The current 5 MiB raw-mail requirement is explicitly superseded only by approval of this plan. No hand-edited SQL or new migration is required. Update only the message_key Prisma comment if its fallback description changes.

## Task 1: Record Approval and Establish the Revision Baseline

**Files:** existing proposal.md, design.md, tasks.md and newsletter-feed/spec.md under openspec/changes/support-newsletter-feed/.

**Interfaces:** Consumes the user's approval; produces coherent requirements for Tasks 2–6.

- [ ] Record the actual approval and reconcile the four existing artifacts as described above. Keep the archive item last.
- [ ] Run pnpm exec openspec validate --all --strict; require zero failures.
- [ ] Record the task branch/head and current clean or user-owned changes. Do not reset local data, stop user services or read secret configuration.
- [ ] Commit the approved planning refinement locally; keep the original branch and PR.

## Task 2: Preserve Receive Results Through Cleanup

**Files:** apps/api/src/entry/core/index.ts; apps/api/src/utils/newsletterTiming.ts; apps/api/test/domain/newsletter/timing.test.ts; new apps/api/test/entry/newsletterCleanup.test.ts.

**Interfaces:** Keep handleEmailEvent(message, env, ctx): Promise<void>. Add cleanupFailed: boolean to NewsletterTiming and emit cleanup_failed in its existing summary. No generic ContextManager behavior change is required.

- [ ] Write RED tests against the actual exported handleEmailEvent, mocking infrastructure boundaries only: ready + disconnect failure resolves; duplicate/rejected + disconnect failure preserves its result; receive rejection + disconnect failure rejects with the original sanitized receive error. Assert one summary, the original outcome, cleanup_failed=true, measured cleanup duration, and no raw error/PII logging.
- [ ] Run pnpm api -- test test/entry/newsletterCleanup.test.ts test/domain/newsletter/timing.test.ts and confirm the current handler fails the new success/error-preservation assertions.
- [ ] Remove the cleanup-failed rethrow/outcome rewrite. Attempt cleanup through its quiet reporter, record cleanupFailed, and log once after cleanup. A rejection from cleanup itself is reported the same way; required receive/store/publish failures still propagate.
- [ ] Re-run those tests and the existing Edge email-dispatch regression. Check generic HTTP cleanup behavior has no feature diff.
- [ ] Commit the scoped correction locally.

## Task 3: Apply Mobile's Original-Link Rule to Web

**Files:** apps/web/app/utils/bookmarkSource.ts; apps/web/app/components/Article/BookmarkArticle.vue; apps/web/app/components/BookmarkList/BookmarkCell.vue; apps/web/app/components/FeedPanel.vue; apps/web/app/composables/bookmark/useBookmarkCellNavigation.ts; apps/web/app/composables/bookmark/useArticleSelection.ts; SnapshotArticleSource.vue only if its explicit original-link consumer still synthesizes unsafe hrefs.

**Tests:** bookmarkSource.spec.ts, BookmarkCellNav.fork.spec.ts, FeedPanel.spec.ts, SnapshotArticleSource.spec.ts and the BookmarkArticle integration test.

**Interfaces:** Export httpOriginalUrl(url?: string | null): string from the Web source helper, using the same /^https?:\/\//i rule as Mobile for strings and returning an empty string for the contract's absent URL. Keep the helper application-owned; do not expand a shared shipped package for this small policy.

- [ ] Add RED tests with hand-written inputs: HTTP/HTTPS and uppercase schemes return the same address; null/undefined/empty, slax-newsletter:, slax-pdf:, javascript:, mailto: and bare example.com return an empty string. Assert absent clickable controls rather than a visible no-op action.
- [ ] Verify Feed mail has no original action, saved mail has a non-link Source and opens its Reader, and an ordinary HTTP article retains its external original link. Test both list navigation preference modes so an original-link preference does not break Newsletter reading.
- [ ] Use the helper for the relevant href visibility and navigation boundaries; retain Newsletter-specific source labels and internal Reader navigation. Do not repurpose urlHttpString globally or alter pasted-URL/import normalization. Check failure/processing and unsupported-content prompts for a remaining clickable no-op; change only reachable affected surfaces.
- [ ] Run the named component/navigation tests and canonical Web typecheck. Inspect light/dark/e-ink and desktop/narrow rendering using existing styles; no new layout, token, icon or demo is required.
- [ ] Commit locally; renewed hands-on acceptance happens in Task 6 before the PR update.

## Task 4: Give Feed Ordering One Contract and Shared Examples

**Files:** apps/web/app/utils/feed.ts; apps/web/app/composables/newsletter/useNewsletterLocalState.ts; apps/web/app/composables/useFeed.ts; apps/api/src/infra/repository/dbFeed.ts only if parity tests reveal an actual ordering defect; new packages/contracts/test-fixtures/feed-order.json; existing API Feed repository and Web local-SQL/Feed tests.

**Interfaces:** Move compareFeedEntries(a: FeedEntry, b: FeedEntry): number into the Feed utility. The shared JSON fixture is test data, not a runtime export or new public API. Keep the existing server SQL/keyset implementation and authenticated REST contracts.

- [ ] Create literal fixtures with expected IDs: unequal timestamps; same-time mixed kinds; multiple RSS UUIDs; mail IDs 9/10/max BIGINT; display published_at differing from received_at. Expected order is written explicitly, never produced by the comparator under test.
- [ ] Run the same fixture through real PostgreSQL-compatible Feed queries and actual local SQLite/composition. Iterate server cursors at page sizes 1 and 2 and require the concatenated sequence to equal the fixture without duplicates or gaps.
- [ ] Move the generic comparator out of the Newsletter module, update its import and remove the old definition. Keep one Web comparator; use shared fixture parity to constrain the SQL rather than fetching all server rows into JavaScript for sorting or introducing a SQL-generation framework.
- [ ] Keep owned-local reads and established non-local REST reads. Do not add a fallback on Newsletter pending/failure, change source limits, fetch RSS history implicitly or merge persistence tables.
- [ ] Run pnpm api -- test test/domain/feed/repository.test.ts test/domain/feed/service.test.ts and pnpm web -- test tests/unit/composables/useFeedLocal.spec.ts tests/unit/composables/useNewsletterLocalSql.spec.ts tests/unit/composables/useFeed.spec.ts; commit locally.

## Task 5: Stream-Filter MIME Before Retained-Content Parsing

**Files:** new apps/api/src/utils/newsletterMime.ts; apps/api/src/utils/newsletter.ts; apps/api/src/domain/newsletter.ts; apps/api/package.json and pnpm-lock.yaml; existing Newsletter parser/content/runtime/EML-script tests; new apps/api/test/domain/newsletter/mimeStream.test.ts. Update the message_key comment in apps/api/prisma/pgsql.prisma if needed; no migration.

**Interfaces:**
- readNewsletterMime(message: { rawSize: number; raw: ReadableStream<Uint8Array> }): Promise<NewsletterMimeInput> owns single-use input, counting/hash, splitting, retained budgets and attachment metadata.
- NewsletterMimeInput contains only a bounded reconstructed mime byte array, complete attachment metadata, a full-input SHA-256 fingerprint and truncation/omitted-CID information needed by the renderer. It contains no ordinary binary attachment buffers or raw original EML.
- parseNewsletterStream(message): Promise<ParsedNewsletter> consumes that input and the existing postal-mime/sanitizer/CID renderer. Keep parseNewsletter(raw: Uint8Array): Promise<ParsedNewsletter> only as a thin adapter for actual local CLI/test callers through the same stream path; remove readNewsletterRaw and duplicated raw-size checks.

### 5a. Prove the dependency boundary first

- [ ] Pin @zone-eu/mailsplit 5.4.29 with existing pnpm policy, without install-script exceptions, release-age exemptions or private config changes. Its Splitter/decoder/Joiner handle MIME boundaries and transfer encoding; postal-mime keeps address, charset, alternative/multipart and body interpretation.
- [ ] Add one narrow integration fixture and run it in the actual local workerd Edge handler with the current compatibility settings. Require successful compilation, chunked MIME parsing, no unsupported Node API and actual ordinary-attachment discard. Record bundled-size delta and the added dependency/license tree.
- [ ] If that compatibility gate fails, stop the MIME task and report the concrete failure for a revised choice. Do not silently use a full-buffer parser, add broad polyfills, expand flags or write a custom MIME boundary parser. Other independent corrections can still be completed.

### 5b. Specify and implement retained-content behavior

- [ ] Add RED tests for a small HTML body with an 8 MiB PDF, boundary-splitting/one-byte chunks using a small fixture, a near-25-MiB message in realistic chunks, actual-byte overflow despite a small declared rawSize, and a failing/truncated stream. Assert successful body and attachment name/size for the allowed messages, bounded retained bytes, and no admission/publication after a failed input. A short stream means actual EOF before declared rawSize, not merely a sender's already malformed MIME ending; preserve the existing malformed-MIME policy separately.
- [ ] Add text/CID regressions: UTF-8/Chinese and quoted-printable/base64 across chunks; HTML/plain alternatives; ordinary text attachments and opaque message/rfc822 attachments; CID before/after HTML; duplicate filenames; missing/unsupported CID; repeated references; and over-budget text/CID. Require intact retained image data, readable text prefix and truthful content_truncated.
- [ ] Count and hash every original byte while respecting input/decoder/output backpressure. Feed the splitter chunks of at most 64 KiB and wait for writable capacity: its push(false) does not immediately stop processing the current input chunk. Enforce 25 MiB against both declared size and actual reads and require EOF at the declared length; finish consumption before publication, or cancel/release on rejection. Oversize/structural policy violations use invalid_message; input stream errors and an early EOF use the existing sanitized infrastructure-failure path without an explicit permanent setReject. Count aggregate headers, MIME depth and parts including skipped content; ignore embedded message/rfc822 as in the current force-attachment policy.
- [ ] Classify parts from parsed MIME metadata. Ordinary attachments retain only metadata and are drained without accumulation; use the library's decoder to count decoded size without storing it. Non-attachment HTML/plain parts have separate 2 MiB transfer-decoded budgets; keep a complete prefix and drain excess. CID raster candidates retain at most 5 MiB collectively, even when the HTML appears later; omit an over-budget image completely and remember its ID. Unreferenced candidates become ordinary attachment metadata. Preserve first-match CID behavior in original part order, including a first match that was omitted: never substitute a later part with the same Content-ID. Add that case and an oversized single input chunk to the high-water tests.
- [ ] Rebuild retained MIME with library encoders and Joiner, preserving multipart structure and original charset headers. Do not cut encoded base64/quoted-printable sequences or manually invent MIME delimiters. Normalize changed leaf transfer encoding through the encoder. Enforce the aggregate 64 KiB retained-structure budget over structural chunks, including preamble/epilogue, and copy retained slices so they do not pin a discarded large input chunk. The finite header/structure/text/CID budgets also bound the reconstructed MIME after base64 expansion; there is no second 5 MiB raw-message gate inside postal-mime rendering.
- [ ] Run postal-mime only on the bounded retained message. Reuse the current safe HTML, tracking filter, 512 * 1024-character render prefix and image proxy. Keep the independent 5 MiB final embedded-URL budget and whole-image omission. Use streamed metadata to display ordinary attachment explanations even if the reconstructed parser omits empty attachment parts. A text/CID truncation is not an incomplete transport; an input stream error must reject.
- [ ] Preserve Message-ID deduplication exactly. Without Message-ID, derive message_key from the full original streamed SHA-256 fingerprint, including discarded attachment bytes; do not hash reconstructed/truncated content. Identical byte replays deduplicate, changed discarded attachments remain distinct. Semantically equivalent re-encoded messages without IDs may be distinct; no compatibility layer or migration for unmerged data is required.

### 5c. Wire and prove the actual receive path

- [ ] Replace the service's read-whole-EML call with parseNewsletterStream. Preserve recipient authorization before consuming data, then existing admit/store/publish and final ownership/enablement checks. read timing covers stream collection/filtering and parse timing covers retained-message parsing/rendering; total time still includes cleanup.
- [ ] Keep local preview and delivery tools on the same processing rules. A Node CLI may hold its local input bytes; that is not the Worker ingestion path. Add an EML replay fixture with a large ordinary attachment and ensure the script no longer rejects it at the old 5 MiB check.
- [ ] Run actual Worker receive/replay, A/B isolation, Save to Inbox and CID-copy independence using synthetic generated attachments and the user's private EML only outside Git. Verify the ordinary attachment is absent from both R2 bodies and the retained-content metadata contains no binary payload.
- [ ] Exercise long-line, tiny-chunk, over-budget text/CID and near-limit cases in workerd. Record timings and retained-byte high-water assertions; a Node-only RSS memory reading does not establish hosted Worker memory or a five-second guarantee. Review peak simultaneous retained representations before claiming boundedness. Commit after the gate and these regressions pass.

## Task 6: Final Review, User Acceptance and Original PR Update

**Files:** current OpenSpec tasks/validation, docs/api/NEWSLETTER-DEV-PILOT.md, and original PR body. No private-config change or new PowerSync rule publication is introduced by these corrections.

- [ ] Self-review Bugs/Security/Compliance against all four comments and the updated OpenSpec. Check zero RSS persistence/rule diff, no schema migration, no full-original-EML accumulation, no ordinary-attachment R2 objects, no raw-error logging and no masked receive failures.
- [ ] Run API/contracts typecheck, full API tests, canonical Web typecheck and full Web tests sequentially under CI Node 22.22.2. Run strict OpenSpec validation and git diff --check. Preserve the direct SQLite built-in loader from the previous CI correction. Broaden checks only for actual touched surfaces.
- [ ] Update the pilot guide with 25 MiB raw receiving, retained-content truncation, cleanup_failed and exact replay dedupe behavior. Record the actual workerd compatibility/performance evidence and any hosted SMTP/native-device gaps.
- [ ] Start or verify existing localhost:8787 API and localhost:3000 Web without resetting user data. Prepare normal, large-ordinary-attachment and CID EML fixtures for hands-on tests of original controls, order, receive/replay, source labels and independent Inbox copies.
- [ ] Obtain and record renewed human hands-on acceptance of the visible changes before pushing the behavior update to PR #349. Retain existing screenshots and replace only groups whose visible behavior changed; do not commit media.
- [ ] Push reviewed commits to the original PR, update its description and verify its current head and CI results. Keep existing assignees/review requests; do not merge or deploy.
- [ ] After the task PR merges, classify unchecked work and archive the OpenSpec change through its separate documentation PR.

## Plan Review and Evidence Limits

This proposal was checked against the current code, published parser interfaces and the existing OpenSpec/design rules. Review corrections already incorporated: ordinary attachment discard does not imply text is streamed; raw and CID limits are separated; cleanup preserves both success and original failure; no-ID fingerprints include discarded bytes; encoded prefixes use library decoding/re-encoding; retained MIME scaffolding and large input views are bounded. Shared order expectations are literal fixtures rather than self-derived comparator results.

An independent read-only builder review reported no Important unresolved ambiguity, contradiction or verification gap. Its two implementation cautions are now explicit requirements: bound each splitter write because output backpressure does not immediately stop a current input chunk, and preserve original first-match CID order even when that first payload is omitted. The review did not install dependencies, execute the proposed parser or validate hosted behavior.

The proposed splitter has not been installed, bundled or executed in workerd in this planning turn. Its source exposes the required split/decoder/join boundaries, but actual runtime compatibility, policy installation and resource behavior remain the explicit first implementation gate, not a claim of completed verification. No business code, current OpenSpec artifact, database or remote service was changed while drafting this plan.

## Primary References

- [Cloudflare inbound limits](https://developers.cloudflare.com/email-service/platform/limits/): inbound Email Routing accepts up to 25 MiB; outbound sending limits are a separate policy.
- [Cloudflare email handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/): raw is a single-use stream; a permanent rejection is explicit. An arbitrary thrown cleanup error is not proof of a particular SMTP reply code or sender retry.
- [postal-mime API](https://github.com/postalsys/postal-mime/blob/master/README.md#api): a stream input is collected before parsing; preserve it only behind the bounded retained-message adapter.
- [mailsplit source/API](https://github.com/zone-eu/mailsplit): Splitter emits node/body/structural chunks, decoders handle transfer encoding and Joiner reconstructs MIME.
- [MailParser stream API](https://nodemailer.com/extras/mailparser): streams attachments, but the inspected implementation still accumulates text bodies. It is not selected as an unbounded drop-in replacement.
