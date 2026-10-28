# Newsletter Team Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the unmerged Newsletter PR's schema and shared-code footprint while preserving receiving, independent Inbox copies and the accepted setup interaction.

**Architecture:** Keep Newsletter persistence separate from RSS. Existing platform bindings own receiving addresses, with application-controlled serialized check-before-insert instead of a new address-uniqueness index. Flatten Newsletter domain modules, put standalone mail HTML extraction in the existing HtmlBuilder, restore ordinary bookmark search processing, and enforce internal snapshot acquisition rules at application boundaries rather than the generic sync repository.

**Tech Stack:** Existing Prisma 7/PostgreSQL, Workers, R2/D1, TypeScript, Vue/Nuxt and Vitest; no new runtime dependency.

**Spec:** Existing `openspec/changes/support-newsletter-feed/` proposal/design/delta specs. The user approved the revisions below on 2026-10-28; they supersede conflicting historical implementation targets.

**Status:** Approved for implementation on 2026-10-28 against commit `afe98912356f7fbdb83d0ae73ef501156cd2197c`. The user clarified that the new account rule applies **only to first Newsletter configuration**, not general Reader account creation/changes. Implementation, review and local API/Web startup are authorized; renewed hands-on acceptance precedes PR updates.

## Global Constraints

- Continue in the existing worktree/branch and update application PR #349 after implementation, verification and renewed human acceptance. Do not deploy or merge.
- First Newsletter account token: exactly 6–15 lowercase ASCII letters/digits, `/^[a-z0-9]{6,15}$/`. Fixed `feed+` and dev/production domains remain unchanged.
- Do not apply that stricter rule to ordinary Reader account settings, existing address reads, envelope case handling or account renames after issuance. Never replace an issued binding.
- Reuse `sr_platform_bind`, its existing `(platform, platform_id)` non-unique index and `(user_id, platform)` unique constraint. Remove only `sr_platform_bind_newsletter_address_key` from the unmerged first release.
- Retain `sr_newsletter_feed`'s primary key, nullability, defaults, dedupe uniqueness and paging indexes. Remove this feature's handwritten CHECK constraints; do not modify historical unrelated migrations.
- Generate the one first-release Newsletter migration through the existing Prisma command. Do not add a later DROP/repair/backfill/compatibility migration for unshipped code or disposable local trial data.
- Newsletter writes only `sr_newsletter_feed` and its own body namespace. Saving to Inbox deliberately creates separate standard bookmark HTML/text objects. `sr_rss_feed`, `sr_rss_entry`, `sr_rss_subscription` and their R2 retention remain unchanged.
- Newsletter and mixed Feed remain REST-based; RSS-only sessions keep existing PowerSync/local-first behavior. Do not introduce a Newsletter stream, local table, sync rule, background job or shared physical feed table.
- Preserve attachment-link/filename policy, tracking-image filtering, signed image proxy, saved-copy sharing defaults, Source presentation and accepted card/dialog interactions.
- Do not read secret files or reset an operator database. Migration generation/validation uses owned disposable local databases and the public runtime configuration template.

## Review Focus

1. Different users can concurrently claim the same address: retain the existing complete-address advisory transaction lock around the check and insert; a user-row lock alone is insufficient.
2. Global account rules and first-mailbox rules differ: a normal short/dotted account remains usable, but cannot allocate a new mailbox until a valid Newsletter account is confirmed; renaming after issuance never changes delivery ownership.
3. Removing the sync repository branch must not admit forged internal create PUTs or reset a ready Inbox snapshot to pending; personal PATCH/delete/restore operations must continue normally.
4. Moving HTML extraction can introduce `HtmlBuilder -> parser -> parserUtils -> processWeixin -> HtmlBuilder` cycles or lose mail links/content. Import the existing Readability package directly, accept already sanitized HTML, and retain full-body fallback.
5. Restoring ordinary search removes strict failure/empty-result and atomic-replacement guarantees. Do not retain those promises or repeatedly reindex unchanged copies; successful storage remains successful even when normal indexing degrades.

## Feedback Coverage and Current Findings

| Feedback | Current finding | Planned result |
| --- | --- | --- |
| 1 | Address provisioning already locks the complete canonical address, checks for any existing binding, then inserts. The partial unique index is additional. | Remove the new index; retain serialized application check and the existing ordinary lookup index. |
| 2 | The initial Newsletter SQL is handwritten and has five CHECK expressions. `gen:diff` already invokes Prisma `migrate dev --create-only`. | Generate one replacement first-release migration from Prisma; move write invariants to owned application paths. |
| 3 | The model has 13 fields and one model-level comment. | Add an English `///` description to every field and explain logical relationships without introducing foreign keys. |
| 4 | Three files live in `src/domain/newsletter/`, beside the flat service. | Flatten content/save domain files and move pure MIME/policy helpers into utils; leave existing RSS directories alone. |
| 5 | Internal targets exist only after Inbox saving. The sync branch prevents forged creation and handles an owned PUT replay specially. | Explain the target; reject internal create PUTs before DB execution, restore generic dbSyncBatch, retain necessary acquisition boundaries. |
| 6–7 | Web accepts up to 59 characters, and the user repository validates a broader Reader account format. | Apply the new rule only to Newsletter first configuration; validate request formats in UserController, keep transactional checks in repositories. |
| 8 | Strict search options were added to distinguish tokenizer/provider failure from legitimate empty results and avoid raw mail diagnostics. | Restore normalizer/vectorize and their ordinary search callers; remove the feature-only strict/atomic path and promises. |
| 9 | Only `ContentParser.parseContentOnly` was added to the common parser. | Restore parser.ts and provide the equivalent standalone extraction entry in existing htmlBuilder.ts. |
| 10 | RSS and Newsletter already have separate models; FeedRepo projects them through an API read query. | Preserve the separation and existing read aggregation; prove zero RSS schema/write/sync changes. |

## Field Documentation to Put in pgsql.prisma

Use `///` immediately above every field. Describe the following exact meanings; do not add columns or relations merely to document them.

| Field | Required description and relationships |
| --- | --- |
| `id` | BIGINT auto-increment identity of one received message; serialize as decimal text, never a JavaScript Number. Used in `newsletter:<id>` and the saved-bookmark target. |
| `user_id` | Logical owner, `sr_user.id`; live-user and Lab checks authorize reads/publication. No new physical foreign key is proposed. |
| `source_key` | SHA-256 of owner UUID + newline + canonical sender; groups this owner's messages into one source. It is not an RSS feed id. |
| `sender` | Canonical lowercase From mailbox, validated during MIME parsing; used with owner identity to derive source_key. |
| `sender_name` | Safe From display name with mailbox fallback; display metadata only, never an ownership key. |
| `message_key` | SHA-256 of Message-ID, or the existing deterministic MIME/body/attachment identity fallback. Combined with user_id and source_key for deduplication. |
| `state` | `pending`, `ready` or `cancelled`; admission starts pending, complete body publication makes ready, disable/deletion cancels pending work. No retry lease or scheduled recovery. |
| `title` | Safe MIME subject with the existing no-subject fallback; published with the body metadata. |
| `summary` | Sanitized selected-body text excerpt, currently capped at 500 characters; not another stored body. |
| `content_key` | Nullable final Newsletter R2 HTML pointer. Ready requires a nonempty owned key; pending/cancelled have no published key. Inbox copies have separate standard bookmark keys. |
| `content_truncated` | Signals input/body sanitization truncation; not a receive-failure or retry flag. |
| `published_at` | Optional validated sender Date; unusable dates are null. This value is display metadata, not the receive-order cursor. |
| `received_at` | Server admission timestamp; used for daily quota and descending pagination with id as the numeric tie-breaker. |

Model/index comments explain the `(user_id, source_key, message_key)` dedupe key and the two owner/source paging indexes. Prisma documentation comments describe the model/client; do not hand-add SQL COMMENT statements or promise database-catalog comments. See the [Prisma 7 comment syntax](https://www.prisma.io/docs/orm/v7/prisma-schema/overview#comments).

## Task 1: Generated Initial Schema and Address Reservation

**Files:** Modify `apps/api/prisma/pgsql.prisma`, replace `apps/api/prisma/pg_migrations/20261022090000_newsletter_feed/migration.sql` with the generator's single new Newsletter migration; update migration references in `test/domain/newsletter/fixture.ts`, `test/infra/newsletterMigration.test.ts` and the operator guide. Verify `src/infra/repository/dbNewsletter.ts` and `test/infra/newsletterPostgres.test.ts`.

**Interfaces:** Preserve `NewsletterRepo.address(userId, domain, provision, confirmedAddress?)`, `admit(...)` and `publish(...)`; no route or schema-consumer change.

- [ ] Change migration regressions to assert no new binding columns/triggers/unique address index or Newsletter CHECKs; retain message-dedupe, populated RSS schema/data/writer invariance and normal binding behavior. Remove tests that expect direct invalid SQL to be rejected by the removed CHECKs.
- [ ] Add a native PostgreSQL race: two live users with the same seeded candidate request concurrently; exactly one obtains the binding and the other gets `address_reserved`. Assert same-user repeat is idempotent and a retained deleted-owner binding remains reserved.
- [ ] Keep the existing `active owner lock -> complete-address advisory lock -> reservation SELECT -> INSERT` transaction. Preserve all binding rows in that check, including deleted owners. Do not replace it with an unlocked preflight query or an in-memory lock. Direct SQL bypassing the application no longer has the removed uniqueness guarantee.
- [ ] Add field documentation. Keep fixed pending/ready/cancelled transitions in the existing repository methods; reject empty/invalid publication keys before mutation, while parser-generated hashes/sender validation stay at their existing input derivation points. No new validation framework or public state-edit API.
- [ ] On an owned scratch PostgreSQL database, remove the old unmerged migration from the generation history and replay all other history as the baseline. Run `pnpm api -- gen:diff --name newsletter_feed`, inspect its output, then `pnpm api -- migration:local` and `pnpm api -- gen:all` with all connections/configuration directed at owned local resources.
- [ ] Commit only the generated replacement first-release migration directory, updating exact test/guide references. Expected SQL is creation of Newsletter table plus its existing dedupe/paging indexes; no sr_platform_bind or RSS DDL, CHECKs, DROP/cleanup migration or unrelated table changes. A second generation check must be empty; omit any empty scratch verification migration. Also replay the final migration history from zero.
- [ ] Run migration/repository tests and opt-in native PostgreSQL races; inspect actual constraints/indexes and compare all RSS columns/indexes/data before/after. Record generation commands and schema-drift results before committing this unit.

`gen:diff` is already `prisma migrate dev --config prisma/pgsql.config.ts --create-only` in apps/api/package.json. A fresh baseline matters: retaining the previous feature migration would generate a later removal patch instead of the requested clean initial migration. Prisma 7 uses shadow migration replay for this comparison and requires explicit generation afterward; see [migrate dev](https://www.prisma.io/docs/cli/v7/migrate/dev) and [shadow database behavior](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database). Do not upgrade Prisma as part of this task.

## Task 2: Newsletter-Only Account Validation at the Request Boundary

**Files:** `packages/contracts/src/feed.ts`, `apps/api/src/handler/http/userController.ts`, `src/infra/repository/dbUser.ts`, `src/infra/repository/dbNewsletter.ts`; Web `app/components/NewsletterAddress.vue`, `i18n/locales/{en,zh}.json`; API setup/repository tests and `tests/unit/components/NewsletterAddress.spec.ts`.

**Interfaces:** Add shared pure `isNewsletterAccount(value: unknown): value is string` implementing `/^[a-z0-9]{6,15}$/`. Keep the existing setting-enable request shape and `invalid_account` response. General account setting remains a separate operation with its current broader policy.

- [ ] Add tests for 5/6/15/16 characters, uppercase, punctuation, spaces, Unicode and digits-only values. `reader01` succeeds; `alex`, `jane.doe`, `Reader01` and 16 characters cannot create a new mailbox. A normal Reader account update is not rejected solely because it fails this new Newsletter-only predicate.
- [ ] UserController checks basic setting request types and the existing broad account format before delegating a normal account update. Move that format check out of `UserRepo.updateUserName`; the repository retains active-owner, canonicalization, advisory locking, occupied-name checking and the UPDATE. Moving validation does not move SQL into a controller.
- [ ] For an explicit Newsletter first-creation confirmation, validate the complete `feed+token@configured-domain` shape/token before provisioning; use the existing exact full-address comparison under the repository lock to reject a stale account/domain. Repeat the first-creation predicate at that write boundary without applying it to existing binding reads or SMTP address matching. Plain Labs enablement continues to create no mailbox.
- [ ] Web uses the same predicate, maxlength 15 and localized 6–15 lowercase-alphanumeric guidance/inline feedback; retain the full preview, permanent-address confirmation, cancellation, pending state, per-user disclosure and centering correction. Do not silently treat uppercase input as valid lowercase input; existing envelope case normalization is unchanged.
- [ ] Verify an issued valid address continues after the Reader account is renamed to a value outside the first-configuration rule. A user with an ordinary nonconforming account must explicitly choose/confirm a conforming account for first setup. Update synthetic fixtures/commands to names such as alex01, without migrating local trial users or adding alias compatibility.
- [ ] Run controller/repository/component tests, types and actual setup HTTP smoke before committing this unit. Malformed direct requests must fail before address writes; business conflicts retain actionable inline errors.

## Task 3: Flat Domain Modules and Existing HTML Builder

**Files:** Keep `src/domain/newsletter.ts`; move `src/domain/newsletter/content.ts` to `src/domain/newsletterContent.ts`, `save.ts` to `src/domain/newsletterSave.ts`, and pure `parser.ts` to `src/utils/newsletter.ts`. Modify `src/utils/htmlBuilder.ts`; restore the feature-only change in `src/utils/parser.ts`. Update imports in repositories, email handler, tests, `script/newsletter-test.ts` and generated DI through its generator.

**Interfaces:** Preserve service class names and `parseNewsletter(raw): Promise<ParsedNewsletter>`. Add `HtmlBuilder.buildNewsletterBody(sanitizedHtml: string): string | null`, a pure DOM/Readability extractor using existing installed dependencies.

- [ ] Port current MIME/content tests to the new imports and add HtmlBuilder cases for long text, short confirmation, multiple articles, links, malformed HTML, attachment-only content and fallback preservation. Existing Tweet/WeChat/podcast builder cases remain unchanged.
- [ ] Move helpers without adding a new src/domain/newsletter directory, service framework, queue or duplicate parser pipeline. Tests may retain their existing descriptive fixture directory.
- [ ] Remove the new `ContentParser.parseContentOnly` method and its only caller. The Newsletter parser passes already sanitized HTML to HtmlBuilder's mail-specific method; preserve the existing content/link comparison, complete-mail fallback and attachment explanation assembly. Do not call the Tweet builder or use URL-specific parser hooks for email.
- [ ] Import Readability directly in HtmlBuilder rather than ContentParser or the parserUtils barrel: the existing WeChat parser already imports HtmlBuilder, so a reverse import would create a cycle. No fetching, image loading or mail-content logging is added to this pure builder method.
- [ ] Regenerate with `pnpm api -- gen:all`; do not hand-edit generated DI/routes. Run MIME/builder tests and the existing offline EML preview harness, then commit this unit.

## Task 4: Internal Bookmark Identity and Generic Sync Repository

**Files:** Restore feature additions in `src/infra/repository/dbSyncBatch.ts`; adjust `src/domain/orchestrator/sync.ts`, acquisition guards in bookmark/controller/orchestrator/queue boundaries, `src/utils/newsletterTarget.ts` and corresponding target/sync tests.

**Interfaces:** Retain saved bookmark identity `slax-newsletter://message/<decimal-mail-id>` and private_user ownership. Incoming `sr_newsletter_feed` rows have no target_url; their API article_url is null. No new identity table/column or invented public URL is proposed.

- [ ] Reproduce why deletion alone is unsafe: an internal create operation with isNewBookmark can reset a ready snapshot to pending in generic executeCreateBookmark. Pin rejection at SyncOrchestrator's PUT metadata decoding before an operation reaches dbSyncBatch; verify no status, relation, body or crawl mutation.
- [ ] Reject internal create PUTs uniformly, including a submitted PUT for an existing snapshot. The first release saves online through its dedicated Feed endpoint and does not originate these local creates. Do not preserve the feature-only owned-PUT replay compatibility branch. Ordinary PATCH/tag/share/read/archive/delete/restore operations on server-created Inbox rows continue through the existing sync path.
- [ ] Restore dbSyncBatch to the reviewed upstream behavior with no Newsletter import, lookup or branch. Inspect every caller before removing a guard; mandatory boundary coverage includes public HTTP before URL rewriting/logging, non-HTTP bookmark/import acquisition, explicit retry, queued parser/retry entry and crawl admission before mutation.
- [ ] Remove the processParseTask inner duplicate once its only caller processParseMessage retains the guard. Keep first-boundary checks where different callers bypass one another; do not mechanically remove all string-prefix checks or add a new generic URL-policy framework. Keep the shared detector as the single definition of the internal scheme.
- [ ] Verify ordinary external HTTP(S) saving/import/retry, saved mail personal mutations, forged/foreign target creation, copied R2 key stability and no workflow/parse task for internal targets. Pin an actual upload-shaped sync request, not only a direct repository unit test, then commit this unit.

## Task 5: Restore Ordinary Content Search

**Files:** Restore feature-only changes in `src/utils/hybridSearch/normalizer.ts` and `vectorize.ts`, and the strict option branches in `src/domain/search.ts`/`src/infra/repository/dbBookmarkSearch.ts`. Update the flattened NewsletterSaveService and strict-only tests.

**Interfaces:** Existing `SearchService.addSearchRecord(ctx, bookmarkId, title, content)` and its ordinary normalization/embedding behavior; no strictPrivate option or Newsletter-specific fulltext replacement API.

- [ ] Test that a new Inbox copy provides its copied text body and title to ordinary search, and an indexing failure cannot remove or fail a committed content copy. An unchanged repeat does not trigger another content-index rebuild; Trash restoration restores the existing user search relation rather than rebuilding unchanged content.
- [ ] Remove strictPrivate plumbing, malformed-provider-response rules and only-used-by-strict atomic replacement helper/tests together. Preserve unrelated upstream changes rather than overwriting the latest dev branch wholesale.
- [ ] Use the existing search/cache/user-relation helpers after a successful new copy. For repeats/restores, reuse existing content and restore/refresh the user search relation/cache as needed. Keep normal notification/changelog semantics for actual create/restore transitions.
- [ ] Update specs and operator claims: best-effort ordinary indexing, provider/empty-result handling and existing diagnostics are shared bookmark behavior. Do not promise strict empty-versus-failure detection, raw-content-free shared diagnostics, automatic index repair on repeated save or Newsletter-specific cross-request atomic indexing. Do not introduce a replacement index job or recovery switch.
- [ ] Run ordinary search regressions and new-copy body-word fulltext smoke; verify repeat/restore preserves the Inbox record and independent R2 objects, then commit this unit.

## Task 6: Integration, Evidence and Original PR Handoff

**Files:** Existing OpenSpec proposal/design/delta specs/tasks/validation, `docs/api/NEWSLETTER-DEV-PILOT.md`, HTTP smoke and the existing EML simulator tests. No PowerSync rule or RSS implementation change is planned.

- [ ] After the user approves this document, reconcile existing OpenSpec artifacts: remove the address-index/CHECK reliance, strict search/repair and owned internal-PUT replay requirements; record the first-configuration-only account rule, flat module design and generated migration procedure. Historical validation remains dated evidence, not a claim for the revised tree.
- [ ] Verify live transitions on owned fresh Workers/PG/R2/D1: first configuration, duplicate address race, mail replay, disable/re-enable and owner revocation; independent A/B reads; original Feed body versus copied Inbox HTML/text; default sharing, repeat/Trash restore, ordinary search and personal sync operations. Do not simulate private EML by committing it.
- [ ] Assert RSS schema/index/data invariance with an existing RSS writer. Compare RSS service/repository/parser/PowerSync files with the upstream baseline; both-kind Feed uses an API read projection (currently UNION ALL), never an INSERT/SELECT mirror or write into RSS. Keep numeric mail cursor ordering and account/kind/source authorization. RSS-only PowerSync and ordinary Inbox bookmark synchronization remain separate from Newsletter Feed transport.
- [ ] Run focused tests per unit, API/Web full suites, API/contracts/Web types, scoped lint/format, `pnpm api -- test:http`, `pnpm api -- gen:all`, `pnpm exec openspec validate --all --strict` and diff checks. Document skipped/hosted checks and generation parity. Avoid redundant full-suite repeats when only documentation changes afterward.
- [ ] Complete final Bugs/Security/Compliance review, prepare local API/Web, and obtain renewed hands-on acceptance of the changed 6–15-character account setup. Recheck modal centering with the real host global stylesheet. This copy/validation change stays inside the previously accepted structure and needs no new discovery demo.
- [ ] Record evidence and update original PR #349, preserving reviewers/assignees and historical media. No new console action is required for these code/schema refinements; deployment/migration of shared dev remains a separate operator rollout.
- [ ] After the task PR merges, classify any unfinished work and archive through the required documentation PR.

## Planning Self-Review

- All ten feedback points have an implementation owner above; username scope follows the user's explicit clarification.
- Removing address uniqueness does not remove concurrent serialization; removing CHECK does not remove typed application transitions, dedupe uniqueness or RSS invariance checks.
- Only the initial unmerged feature migration is replaced. Its timestamp/path references and clean generation baseline are explicit; no compatibility/cleanup migration or operator reset is hidden in the procedure.
- The account-format move is validation-only, not a repository call from Controller. Repositories still own transactional identity/uniqueness decisions; existing address reads and renames stay stable.
- An internal target belongs to the saved Inbox copy, not the incoming Feed row. Removing dbSyncBatch's special handling is paired with an upstream create-boundary rule, while ordinary personal synchronization remains.
- HTML builder dependency direction and sanitization/fallback are explicit. Shared normalization/embedding files and related strict-only helpers are restored together, with the weaker ordinary-search contract stated rather than silently retaining old guarantees.
- No implementation tests, migration generation, live request mutation or deployment were performed for this planning document. Current code findings are based on the checked-out PR, its diff against origin/dev and the repository's command/config sources; the external references describe the installed Prisma major version.
