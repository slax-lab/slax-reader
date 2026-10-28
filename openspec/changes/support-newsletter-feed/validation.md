# Current revision: independent Newsletter storage and Inbox copies

Revision approved by the user on 2026-10-28. During acceptance, the user explicitly replaced the special disabled-sharing default with ordinary account-default sharing and requested the standard Source module. That later decision supersedes earlier disabled-sharing evidence below. The requesting user completed renewed hands-on acceptance on 2026-10-28 and authorized the existing PR updates; the handoff is recorded below.

## Newsletter scheduled collection deferred (2026-10-28)

The user's latest instruction defers collectNewsletterBodies and Newsletter-specific scheduled work to a later iteration. This supersedes all earlier collector/GC guarantees below. The cron source, generated cron/DI registration, body sweep, KV cursor, reference-query method and sole-purpose content_key index are removed together. The initial unmerged migration is edited directly, without a new migration or trial-database compatibility. Existing shared schedules, RSS, synchronous publication, known-losing-attempt discard and ordinary owner cleanup remain unchanged. Interrupted writes, ambiguous commits or failed deletes may leave unreferenced R2 objects; the first release does not promise their background removal.

- Regression first: the revised hourly dispatcher expectation failed because the prior generated code still invoked collectNewsletterBodies. After source removal and generation, both cron-dispatch tests pass, preserving the hourly Trash job and all existing five-minute shared jobs. The obsolete collector test was removed with its implementation; the four remaining content tests cover receive/deduplication, failed storage/replay, disable/re-enable fencing and invalid-envelope rejection.
- Required schema workflow passed on a fresh owned PostgreSQL database: migration bootstrap, `pnpm api -- gen:diff --name verify_newsletter_no_gc`, `pnpm api -- migration:local`, then `pnpm api -- gen:all`. The generated verification migration was empty and removed before application. PostgreSQL confirms the collector-only index is absent and the receiving-address unique index remains. Both unchanged local D1 steps had no migrations to apply. Generated cron/DI changes remove only the collector; unrelated router whitespace churn was discarded.
- Full API verification passed **2564 tests / 118 skipped**, 202 files passed / 15 skipped: `pnpm api -- test --no-file-parallelism --hookTimeout=60000`. The one-test reduction is removal of the obsolete collector test. API/contracts typecheck, scoped production lint, source/test/generated formatting, strict OpenSpec **79/0** and diff checks passed. The zero-RSS-diff audit remains clean. No new Web or native-app runtime/package surface changed, so the accepted UI baseline remains applicable without another Web run.
- Actual `pnpm api -- test:http` passed in owned fresh Edge/Core/PostgreSQL/R2/D1/Jieba resources: receive/read/replay, private Feed access, deleted-owner denial, independent Inbox copies, ordinary sharing, repeat/restore and search remained green. Scheduled dispatch is covered by generated-dispatch tests; hosted cron invocation, SMTP/routing and provider subscriptions were not exercised and remain rollout gaps. No hosted deployment, console edit, remote migration, operator PostgreSQL reset or merge was performed. Only owned scratch resources were removed.
- Fresh read-only Bugs/Security/Compliance review found no Important issues or Nits in this delta and surrounding lifecycle. The reviewer did not rerun tests or judge hosted delivery, unchanged UI acceptance or the pre-existing feature baseline; the coordinator verified the current runtime/check outcomes above.

## Simplified account revocation (2026-10-28)

The user explicitly requested removal of the binding retirement field and its trigger, reusing existing sr_user.deleted_at. This revision supersedes earlier references to binding retirement or database-level immutability. The original unmerged migration is edited directly: no new sr_platform_bind columns, function or trigger, and no follow-up cleanup/compatibility migration. The receiving-address partial unique index remains. Ordinary application provisioning keeps issued addresses stable, and cleanup retains Newsletter binding rows as reservations.

Recipient lookup joins an undeleted owner; address access, admission and final publication reuse the existing owner check/row lock. Account deletion sets sr_user.deleted_at, revokes keys and cancels pending mail in the existing transaction. No binding retirement update remains. RSS code and schema are unchanged.

- Regression first: the new migration test failed against the previous schema because it added a binding column. After implementation and updating an obsolete revocation mock, targeted migration/Newsletter/revocation/deletion verification passed **59 tests**. Command: `pnpm api -- test test/infra/newsletterMigration.test.ts test/domain/newsletter test/utils/accountRevocation.test.ts test/domain/userDeletionRecovery.test.ts --no-file-parallelism --hookTimeout=60000`. Cases include unchanged binding columns, no custom trigger, normal UPDATE/DELETE behavior, duplicate-address rejection, deleted-owner address/admission/publication denial, pending cancellation and retained reservation.
- Required schema workflow passed against an owned fresh local PostgreSQL database: initial migrations, `pnpm api -- gen:diff --name verify_newsletter_binding_simplification`, `pnpm api -- migration:local`, then `pnpm api -- gen:all`. The generated diff contained only `-- This is an empty migration.` and was removed before applying. PostgreSQL reports zero retired_at columns, zero custom binding triggers and one receiving-address unique index. Both unchanged local D1 migration steps reported no migrations to apply. Generated registration/type outputs had no functional change; unrelated router whitespace churn was discarded.
- Native PostgreSQL verification passed **5 tests** with `NEWSLETTER_LOCAL_PG_TEST=1` against that owned database: concurrent admission/publication, final quota slot, disable/re-enable fencing, parallel Inbox copies and tag restoration. API/contracts typecheck passed.
- Full API verification passed **2565 tests / 118 skipped** (202 files passed / 15 skipped): `pnpm api -- test --no-file-parallelism --hookTimeout=60000`. The two additional passing cases cover binding schema/trigger invariance and existing account-deletion fences. Scoped production lint has zero errors and six unchanged dbUser warnings; test files are excluded by the existing lint configuration and were checked with Prettier instead. Strict OpenSpec validation passed **79/0**, and `git diff --check` passed.
- Actual `pnpm api -- test:http` passed with fresh owned Edge/Core/PostgreSQL/R2/D1/Jieba resources. Its additional fixture sets only sr_user.deleted_at and verifies email rejection, HTTP 401 for authenticated Feed access, no additional mail row and an unchanged binding reservation. The harness restores only that synthetic fixture's user state to continue its existing receive/save/sharing/restore smoke. This does not add a product restore flow or alter an operator account/database. Existing receive/deduplication/Inbox body/search/sharing checks remained green.
- Fresh read-only Bugs/Security/Compliance review of this delta and surrounding binding/deletion lifecycle found no Important issues or Nits. Hosted delivery, prior trial-database history and previously accepted UI were explicitly outside that review; hosted delivery remains a rollout gap, trial compatibility is excluded by the user's instruction, and UI has no new change. The previous Web suite and human acceptance remain baseline evidence; Web was not rerun for this backend-only revision.

This backend-only revision changes no UI, cross-app API shape or CLI/Extension/Mobile package output; the user's existing hands-on acceptance still applies. Hosted SMTP/routing and provider subscriptions remain rollout gaps; no deployment, remote migration or merge is authorized by this revision.

## PR handoff (2026-10-28)

The accepted implementation and documentation were pushed to the existing [application PR #349](https://github.com/slax-lab/slax-reader/pull/349); matching README guidance was pushed to [private configuration PR #7](https://github.com/slax-lab/slax-reader-config/pull/7). The application still targets dev and the configuration PR retains its original main target and draft state. Existing assignees/review requests are unchanged, including no assignee/reviewer on the configuration PR. Both supplied screenshots were uploaded with `gh pr edit --attach`, their body references were verified as GitHub asset URLs, and the older receive/read screenshots remain in a collapsed historical section. No screenshot binary is committed.

User-provided evidence: [Feed preview](https://github.com/user-attachments/assets/d8c4ae06-22fe-4f34-920c-38b3088ebb65), [saved Inbox detail](https://github.com/user-attachments/assets/17eb93ac-d384-4676-8108-333c9fc25aaf).

Remote CI was still running at handoff; the passing local checks above are not a claim that remote CI has completed. The worktree and requested local API/Web services are preserved for further review. The task PR remains open; archiving is deliberately deferred until merge through the required documentation PR.

## Final pre-push verification (2026-10-28)

- Full API suite: **2563 passed / 118 skipped**, 202 files passed / 15 skipped. Command: `pnpm api -- test --no-file-parallelism --hookTimeout=60000`. The initial simultaneous API/Web run hit a 10-second PGlite beforeAll setup timeout; serialized API verification with a longer hook allowance passed all enabled tests. No product or test configuration was changed to hide a failure.
- Full Web suite: **2570 passed / 3 skipped**, 227 files passed / 1 skipped. Command: `pnpm web -- test --no-file-parallelism --testTimeout=60000 --hookTimeout=60000` using the documented public placeholder environment. Existing api.test DNS diagnostics were non-fatal. The earlier actual HTTP smoke, typechecks, lint and generation remain applicable to this same functional tree.
- A fresh read-only reviewer checked the acceptance delta, surrounding source/sharing code and revised OpenSpec in Bugs/Security/Compliance passes. No Important findings; its single stale acceptance-status Nit was corrected while finalizing this record. It did not rerun builds/tests concurrently with the coordinator.
- Reviewer-declined hosted SMTP/routing, hosted replication, semantic-provider embeddings, native-app acceptance and unexercised accessibility modes remain declared verification gaps, not claims of production readiness. These do not block the requested local-feature PR handoff; no merge/deployment is performed. No CLI/Extension/Mobile runtime/build contract changed.

## Renewed human hands-on acceptance (2026-10-28)

The requesting user tested the running local API/Web environment and accepted the current implementation as broadly matching expectations, explicitly authorizing code submission to the existing PR and use of the two supplied screenshots in its description. The accepted corrections were entry-specific save progress in list/preview, ordinary account-default sharing for new Inbox copies, and the existing Source module styling instead of the long email-copy/privacy paragraph.

The operator-provided screenshots at 14:19:04 and 14:19:32 show a real received email in the Feed preview with Save to Inbox, then its opened Inbox copy with the Source: Newsletter · sender capsule. These images establish the manually exercised receive/read/save/source presentation; they do not independently prove remote SMTP delivery, loading animation, sharing authorization, quota/concurrency, Trash restoration or PowerSync replication. Those agent-executable cases retain their separate automated/local-runtime evidence and declared gaps. Media is uploaded as GitHub attachments, never committed. No deployment or merge was requested.

## Latest acceptance adjustments: ordinary sharing and standard Source (2026-10-28)

New Newsletter Inbox copies create no per-bookmark sharing override and follow the current account-level sharing setting. Save/restore preserves any existing per-bookmark choice. Storage remains owner-isolated with independent HTML/text keys; private Feed reads and acquisition guards are unchanged. No trial-data compatibility or new migration was added, and existing local copies are not bulk-updated.

The old saved-content paragraph and its English/Chinese translations are removed. BookmarkArticle now reuses SnapshotArticleSource with localized Newsletter and sender text. Sources without a URL render as a non-interactive element with no href/target/external arrow; ordinary website sources retain their original link, author and style behavior.

- Regression-first API tests reproduced the forced share override; the source regression reproduced the empty external link. Targeted API verification passed **33 tests** (Newsletter save/repository and bookmark access security). Targeted Web verification passed **20 tests** (source module, existing PDF source, Feed panel and composable).
- `pnpm api -- gen:all` passed and generated the reduced NewsletterSaveRepo dependency wiring. Unrelated generated router ordering churn was discarded; generated types/consumer output had no final differences. API/contracts typecheck passed.
- Canonical Web typecheck, API/contracts typecheck and scoped API/Web lint passed. Strict OpenSpec validation passed **79/0** and `git diff --check` passed. No native CLI/Extension/Mobile logic, contracts or package output changed.
- Actual `pnpm api -- test:http` passed in its owned fresh Edge/Core/PostgreSQL/R2/D1/Jieba environment. It verifies zero override rows for a new copy; anonymous and other-user metadata reads with global sharing on; denial with global sharing off; owner access; explicit per-bookmark off overriding global on and surviving Trash restore; dedupe, copied body/search and disabled Newsletter behavior. The prior forced-off HTTP expectations were revised to the newly requested contract. No operator account's sharing setting was changed.
- Actual BookmarkArticle ran in the isolated Nuxt browser fixture with synthetic data. Default desktop light, 390px dark and 768px e-ink all displayed the existing 12px Source capsule, Newsletter and sender above the title; the paragraph, synthetic link and external arrow were absent. Narrow-screen source/page overflow checks passed. Existing website/X/PDF source unit cases remained green. Screenshots stay outside Git at `/tmp/newsletter-inbox-source-light.png`, `/tmp/newsletter-inbox-source-dark.png` and `/tmp/newsletter-inbox-source-eink.png`. The browser fixture does not establish authenticated backend behavior; that is covered separately by the actual HTTP smoke.
- Temporary fixture services/tabs were stopped and the viewport reset. The requested localhost:3000/8787 integration services remain running for renewed human acceptance. No hosted routing or deployment was performed.
- Local Bugs/Security/Compliance review of this delta found no Important issues: normal share policy is reused rather than forced on, explicit choices remain untouched, the internal mail identity never becomes a web link, and current plan/spec/operator guidance agree with the user's revised request. Earlier independent review records cover the implementation baseline; this delta's human hands-on acceptance is recorded below.

## Earlier automated evidence (sharing default superseded)

### Save-progress acceptance correction (2026-10-28)

The user reported that Save to Inbox lacked visible progress. The mixed Feed now exposes the active save identity to both the list and reader preview, reuses the existing localized saving text and theme-aware refresh icon, and retains the existing request-wide duplicate-activation guard. Completion/failure clears progress; account/permission changes invalidate it without letting an older request clear a newer save. RSS-only components and services are unchanged.

- RED: the two targeted regression cases failed on the missing progress state/text. GREEN: `pnpm --dir apps/web exec vitest run tests/unit/components/FeedPanel.spec.ts tests/unit/composables/useFeed.spec.ts` passed **12 tests**, including failed-save retry and late-response isolation across disable/re-enable.
- Browser exercise used the actual Feed components in the isolated Nuxt fixture with a synthetic 2.5-second save response, not an artificial delay in the application. Light/default desktop showed spinning progress in both list and preview, failure restored the action and retry produced the saved route. At 390px dark, the saving row remained usable without horizontal overflow; unrelated rows did not spin. At 768px e-ink, saving text and disabled/busy state remained visible with computed animation `none` and no horizontal overflow. Existing reduced-motion CSS is reused; a separate OS reduced-motion preference was not exercised.
- Screenshots are local, outside Git: `/tmp/newsletter-save-progress-list.png`, `/tmp/newsletter-save-progress-preview.png`, `/tmp/newsletter-save-progress-dark.png`, `/tmp/newsletter-save-progress-eink.png`. Temporary fixture services/tabs were stopped and the browser viewport reset; the requested localhost:3000/8787 integration environment remains running.
- Scoped ESLint reported zero errors and existing selector/typing warnings. The initial direct typecheck ran while the isolated fixture owned Nuxt-generated plugin types and therefore reported fixture-related PowerSync type errors. After stopping it, canonical `pnpm web -- typecheck` regenerated the normal types and passed. Strict OpenSpec validation passed **79/0** and `git diff --check` passed. The normal local login page returned HTTP 200 after cleanup.
- Local Bugs/Security/Compliance review of this correction found no Important issues: state lifetime follows existing session/permission fences, no new transport/storage/logging or dependencies were introduced, and the requested waiting/retry behavior is recorded in the existing approved change. The user later accepted the revised save/source UI on 2026-10-28; see the acceptance record above. The original PR update is recorded below.

### Independent-storage implementation baseline

- Final API complete suite (`pnpm api -- test`): **2561 passed / 118 skipped**, 202 files passed / 15 skipped. Database suites are opt-in, and one existing listener-ownership fixture skipped because the requested local dev services are running.
- Final Web complete suite: **2567 passed / 3 skipped**, 227 files passed / 1 skipped. Command used the public fixture environment documented in the historical record and `pnpm --dir apps/web exec vitest run --no-file-parallelism --testTimeout=60000 --hookTimeout=60000`. A single package prebuild preceded it; no concurrent prebuild deleted selection output. Existing api.test DNS diagnostics were non-fatal. Earlier broad runs exposed stale shared-sidebar expectations, a selection-build import race, a Nuxt import timeout and an intentionally RED activation regression; the final complete run supersedes them.
- Contracts/API and Web typechecks passed. Scoped lint has no errors; existing DOM-selector/typing warnings remain. Strict OpenSpec: **79 passed / 0 failed**. `git diff --check` passed.
- Required schema workflow completed against owned scratch resources: `gen:diff` produced an empty migration (inspected and omitted), then `migration:local` and `gen:all` passed. Generated DI/routes/cron/types were regenerated, not hand edited. The unmerged initial DDL is rewritten directly; no compatibility or cleanup migration exists.

## Running environment

- Native PostgreSQL multi-connection suite: **5 passed**. Duplicate admissions reserve one identity; competing publications select coherent metadata/body; concurrent quota admissions cannot exceed 200/day; disable/re-enable cancels admitted work; concurrent Inbox publications create one private destination. Actual `BookmarkRepo.updateBookmarkDeleteAt` was exercised with a real vocabulary/tag relationship, and save restoration reactivates the same tag UUID transactionally.
- Native RSS migration invariance: complete populated RSS table/index/constraint/trigger schema dump is identical before/after Newsletter DDL. A concurrent RSS writer committed while Newsletter migration completed in 83ms under a 500ms lock timeout. The migration introduced no RSS lock/backfill/mirror.
- Fresh actual Edge/Core HTTP smoke passed with isolated PostgreSQL/logs, local D1/R2, generated DI/routes, the actual email handler and real Jieba. It covers plus-address provisioning and envelope rejection, two-user isolation, dedupe, sanitized body, independent HTML/text save, explicit share=false, owner read, anonymous/other-user denial, repeat/Trash restoration and Inbox read after disabling Newsletter. It asserts saved raw text contains the received body and an actual FTS `content:runtime` query finds it; a subject-only index row does not satisfy this check. Synthetic EML replay invokes the real local CLI. No hosted resource was mutated.
- Snapshot lifetime tests delete the original body and retain the independent copy. Storage failure publishes no pending bookmark and cleans its own files; lost COMMIT acknowledgement preserves a committed copy; failed indexing leaves a ready copy and a repeat save repairs indexing. No original EML or binary attachments are persisted.
- Isolated PowerSync setup smoke passed on diagnostic rerun with newly migrated databases, isolated ports/volumes and both services healthy. The first run exited on transient unhealthy startup. This establishes local setup readiness, not authenticated stream contents. Static rules assertions and the zero-RSS-diff audit cover original RSS source names and absence of a Newsletter stream. Authenticated replicated bookmark/RSS row delivery remains a separate acceptance gap; no stream-level success is inferred from liveness.
- Actual Feed components/composable ran in an isolated Nuxt browser fixture with synthetic HTTP boundaries. Browser actions exercised failure/retry, URL-less saves from list and preview, exact saved identity updates, saved routes, attachment explanation and keyboard Enter/Escape. Layouts were visually checked at 1440px light, 390px dark and 768px e-ink. Screenshots stay outside Git. This is agent UI evidence, not user acceptance or actual backend evidence.
- Requested operator API/Web are running from the existing worktree at `localhost:8787` / `localhost:3000`. The disposable local PostgreSQL trial database was reset explicitly for the revised initial migration, as authorized by the user; no automatic reset/repair code was added. Login and Newsletter enable/provision are needed again. Cloudflare console configuration is unchanged by this revision.

## Independent review and remaining acceptance

The single fresh-context reviewer completed Bugs, Security and Compliance against `support-newsletter-feed`, including tracked/untracked implementation and bounded private README changes. Four Important findings were reproduced, fixed and rechecked: restoring tags; guarding internal source links; queued Feed saved-state revalidation after returning from Inbox; full-document mail HTML preserving derived text. The reviewer independently ran 53 focused API tests and 12 content/save tests after corrections. Final verdict: **no remaining Important findings or Nits**.

RSS service/content/parser/repository/image files, RSS contracts, original RSS panel/composable/local schema and PowerSync rules match `origin/dev` byte-for-byte. Shared Feed navigation tests alone adopt the approved always-visible Feed behavior. The private configuration revision changes README rollout guidance only; no domain/credential changes are required.

Human hands-on acceptance of the revised Save to Inbox/source UI was completed on 2026-10-28; see the acceptance record above. Earlier PowerSync EML screenshots establish the old receive/read interface only. Hosted SMTP retry, real Newsletter subscription platforms, hosted routing/replication, semantic-provider embeddings and native Mobile/CLI/Extension acceptance remain unverified in this local run. No CLI/Extension/Mobile runtime/build/dependency output changed; no application-version choice was required. Reduced-motion and every native input/accessibility mode were not separately exercised; established component patterns remain; the requesting user accepted the revised UI as recorded above.

## Superseded historical record

---

> Current decisions (2026-10-28): Newsletter is an unshipped first release. Addresses use immutable platform bindings and numeric receipt IDs. The user deferred recoverNewsletter: no Newsletter cron, replay payload, retry schedule or attempt counter remains. The initial unmerged DDL is edited directly; no additional migration or operator-database reset/repair is performed. Only a new actual delivery or explicit EML replay can resume pending work. Existing RSS compatibility and shared scheduled jobs remain.

> Current domains: dev uses newsletterreader.slax.dev; beta/prod/legacy-main use newsletterreader.slax.com. Cloudflare receiving and hosted RSS synchronization still require separate operational acceptance. Newsletter reads use REST; Newsletter PowerSync and Save to Inbox remain deferred.

> The user accepted a real EML in local API/Web on 2026-10-28 and authorized the three screenshots in PR #349. Dated records below preserve historical evidence; the latest no-recovery section supersedes earlier staging, migration and activation requirements.

# Validation

## Original implementation (2026-10-22)

### Environment and scope

Branch `feat/support-newsletter-feed`, based on `origin/dev` `4fa9ff08`, in a new Codex-managed worktree. At the original validation date, no remote deployment, DNS, Email Routing, private configuration edit or remote database mutation had been performed. Synthetic local resources were created and removed by the HTTP smoke harness. A subsequent user-requested local integration environment applied the additive Newsletter migration to the existing local development PostgreSQL database and initialized worktree-local D1/R2 state. Existing operator configuration is loaded through normal application startup; secret file contents were not printed or copied by the agent.

## Automated checks

- `pnpm install --frozen-lockfile`: passed (Node 24.15.0, pnpm 11.25.0). postal-mime 4.1.3 subsequently pinned with its lockfile and a documented release-age exception; it has no lifecycle installation hooks or runtime dependencies.
- `pnpm api -- gen:all` with the public example configuration and generation-only PostgreSQL placeholders: passed. Generated model/router/DI/cron and Worker runtime types are included.
- `pnpm api -- test`: **2352 passed, 71 skipped**, 181 files passed / 12 skipped (final run 2026-10-22 16:18 Asia/Shanghai). Skips are the existing opt-in PostgreSQL suites and sample fixture tests; the changed repositories were exercised separately with embedded PostgreSQL and actual local PostgreSQL below.
- `pnpm api -- typecheck`: passed; contracts and API TypeScript checked.
- `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example pnpm api -- build edge`: passed. It is an offline dry run and performs no publication.
- Scoped API ESLint: **0 errors**, 14 warnings including existing any/unused declarations and required route request parameters. No new lint error remains.
- Clean sequential full Web suite with explicit public fixture environment (PUBLIC_BASE_URL/AUTH_BASE_URL/SHARE_BASE_URL=https://reader.example.test, COOKIE_DOMAIN=localhost, COOKIE_TOKEN_NAME=slax-review-token, DWEB_API_BASE_URL=http://localhost:3058, GOOGLE_OAUTH_CLIENT_ID=local-fixture, SLAX_API_CONFIG=deploy/cloudflare/api.toml.example): **2518 passed, 3 skipped**, 220 files passed / 1 skipped, on 2026-10-22 16:28 Asia/Shanghai. This includes the legacy account-setting error regressions. A non-fatal happy-dom fetch AbortError was printed during teardown; no Vitest failure/unhandled-error summary or pnpm failure occurred.
- Earlier Web attempts are superseded: two temporary template parse failures during a concurrent edit; Nuxt build/test cache interference from running build concurrently; and two existing locale fallback tests without required cookie configuration. The final run used sequential preparation and explicit non-secret configuration and passed all tests.
- Web production build with public placeholder configuration: passed. Web typecheck after production build/prepare: passed.
- `openspec validate --all --strict`: **73 passed, 0 failed**. Existing informational archive notices elsewhere in the repository remain unchanged.
- `git diff --check`: passed.

## Running API exercise

`pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz`: **passed**, 2026-10-22 16:19 Asia/Shanghai. The archive is a public pinned pnpm distribution prepared by `corepack pack`; no private cache or credentials are inherited. The harness runs actual Edge/Core entrypoints through local Wrangler, full historical PostgreSQL/logs/D1 migrations, real Prisma/pg transactions and local R2.

Exercised:

- Authenticated account setting and independent Newsletter Lab enable through actual generated HTTP routes.
- Address provisioning `newsletter-smoke@slax.dev` through Core, followed by two raw RFC5322 deliveries to the actual Edge email handler.
- Envelope recipient controls ownership even when header To names another address; duplicate Message-ID yields exactly one durable receipt and one entry.
- Core Feed subscriptions/list/body expose the Newsletter kind and read the body object written by Edge; script/CID content is absent.
- Newsletter disable hides entries and denies body reads; unknown routed recipient creates no receipt.
- Existing HTTP authentication, CORS, bookmark sharing/save/delete, D1/fulltext and PostgreSQL smoke flows still pass.

The first real run exposed Prisma's unsupported void-column decoding for advisory locks, which embedded PostgreSQL did not reproduce. Changed the new locks to execute-only SQL and verified account-setting and provisioning in the successful run. Local startup also needed the official tsx loader API to avoid macOS Unix-socket length limits in this long worktree; this changes only the smoke launcher.

Additional database/service tests exercise immutable duplicates, quotas including pending receipts, quota preflight before R2 writes, raw-write failure before admission, body-write failure after admission and later recovery, raw GC preserving pending obligations, retirement on deletion, disable/enable fencing, stable address after rename and reservation conflicts. RSS tests cover legacy endpoint/write/poll/history/quota/retention kind isolation and preservation of truncated-body metadata. Feed tests additionally exercise actual loopback HTTP with embedded PostgreSQL, cross-user denial and cursor/source/type scope.

## Running Web exercise

Actual Nuxt Web components and routes were exercised in a browser at local ports 3057/3058 against deterministic fixture API responses. A temporary layer outside the repository replaces the PowerSync plugin with the supported REST fallback. It does not validate live PowerSync or SMTP.

Browser matrix passed at **1440, 768 and 390px**, in **light, dark and eink**. For every width/theme: mixed Feed, source switching and Newsletter preview were exercised; body overflow was absent, keyboard focus remained visible, and reduced-motion preference was set. E-ink backdrop blur is disabled and Newsletter previews have no empty action footer. The matrix also exercised address provisioning/copy, missing account form, reserved-name recovery, unavailable receiving, both-off onboarding/Labs navigation and independent feature toggles. Final browser results had **zero page errors**.

Findings repaired and covered: exact-768px shell/sidebar breakpoint mismatch, duplicate avatar text in source accessible names, Newsletter-only empty copy, second sanitizer losing truncation, unsafe relative srcset resolution, and stale processing across disable/re-enable. Screenshots are temporary local artifacts, not committed to Git.

## Full local integration environment

On 2026-10-22, started the feature worktree's actual API Workers (Edge 8787, Core 8686, AI 8788 and Browser 8789) and Web on port 3000. The local-only Newsletter configuration uses `NEWSLETTER_ENABLED=true` and `NEWSLETTER_DOMAIN=newsletterreader.slax.com`; this matches addresses locally without creating DNS or mail-routing records. Existing operator configuration remains unchanged. Cloud-only AI/browser-rendering/vector/analytics integrations are excluded from this local pilot.

- `pnpm api -- migration:deploy:pgsql` with an explicit loopback development database applied `20261022090000_newsletter_feed`; local D1 and fulltext migration commands completed with no pending migrations.
- A separate `newsletter-local-powersync` container on loopback port 18082 loads this branch's sync rules, uses its own local `newsletter_local_sync` storage database and the existing local source database. Its readiness endpoint returned HTTP 200; logs confirmed snapshot completion and activation of the PostgreSQL replication stream. Existing PowerSync containers were preserved.
- `/ping` returned HTTP 200, unauthenticated Newsletter-address access returned the expected authorization error, and Web `/login` and `/bookmarks` returned HTTP 200. Browser inspection confirmed the rendered login controls.
- A raw message injected through `/cdn-cgi/local/email` to an unbound local address returned HTTP 400 with the generic application rejection. A temporary local helper was provided for HTML, plain-text and duplicate Message-ID deliveries to the address copied from Web.
- These startup and readiness checks do not independently establish every authenticated PowerSync stream or cross-user isolation scenario. The human's subsequent integration acceptance is recorded below; specific per-case results were not supplied.

## Human hands-on acceptance

**yjc**, 2026-10-22, in this task before any PR: opened `http://localhost:3058/__sandbox/bootstrap`, exercised Feed switching, Newsletter body and address copying, and replied **“已操作，界面可以接受”**. No human-requested adjustment remained. Agent-discovered responsive/accessibility/empty-footer polish was then verified by the browser matrix. The review sandbox contains fixture data only.

**Additional integration acceptance:** yjc, 2026-10-22, after the full local API/Web environment above was prepared, reported that testing matched expectations and authorized proceeding with the PR. No additional adjustment was requested. This supplements the earlier pre-PR UI acceptance; it does not claim external SMTP delivery or enumerate unreported test cases.

## Review and release assessment

Bugs, Security and Compliance passes resolve to OpenSpec `support-newsletter-feed`. Independent review found no remaining Important code issue; its pending evidence finding is addressed by this record. No CLI, Extension or Mobile shipped behavior, dependency graph, contracts consumed by them or package output changes: the new contracts are additive and legacy RSS interfaces/projections are unchanged, so no application version increment is required. Root manifest/lock changes may still select those applications for CI checks.

## Gaps and operator work

- **Not deployed to slax.dev.** Matching real Edge/Core PostgreSQL/R2 bindings, private CI configuration, live hosted PowerSync rule publication and Cloudflare root-domain Catch-all activation require the dev release/operator sequence. The exact-address pilot has been superseded by the approved 2026-10-27 revision.
- **No real external SMTP test.** Local email dispatch and application rejection are verified; sender bounce/delivery status and Cloudflare's behavior on an infrastructure failure before durable admission require a dedicated dev test. Post-admission publication recovery is covered locally.
- **No hosted PowerSync acceptance.** The separate local server replicated successfully and the user accepted local integration testing, but hosted rule publication and explicit cross-user/kind isolation with real synchronization remain dev rollout checks before expanding the pilot.
- Newsletter source management/automatic unsubscribe/Inbox save/attachments are deliberately absent. Subscribed mail has no 30-day expiration; monitor storage and pending-receipt age. The retry batch is capped at five per five-minute tick.

Operator steps and human test cases: [Newsletter dev pilot](../../../docs/api/NEWSLETTER-DEV-PILOT.md). Beta/main admission stays off until all shared-database readers and sync rules have RSS kind isolation.


## Historical root-domain revision (2026-10-27, superseded before deployment)

### Scope and configuration

The user approved dev `<account>@slax.dev`, production `<account>@slax.app`, and preservation of the existing production business mailbox. The feature branch was synchronized with `origin/dev` (`79491af2` at the start of the update); conflict resolution retained the upstream fork smoke harness, generator controller inventory and API development documentation. No UI template, style or translation changed in this revision, so the pre-PR human acceptance above still covers the unchanged presentation.

Application policy rejects `daguang@slax.app` case-insensitively on address GET/POST and recipient lookup, including stale bindings. It leaves `daguang@slax.dev` eligible and preserves a different issued address after a later rename to daguang. Registry ownership is neither deleted nor reassigned. The existing `address_reserved` contract/UI is reused; no new runtime variable, migration or public DTO is introduced by this revision.

Private configuration PR #7 changes only `NEWSLETTER_ENABLED`/`NEWSLETTER_DOMAIN` plus README guidance: dev is true/slax.dev; beta, prod and the legacy main copy are false/slax.app. All four TOMLs parse; a selected-key comparison and exact-byte comparison after removing only those two key lines confirm that all unrelated configuration remains unchanged. No sensitive file was printed or copied. Configuration is prepared for review, not deployed. Main application deployment consumes api/prod.toml.

### Automated and running-environment evidence

- Regression-first check: baseline Newsletter tests **21 passed**; the three added reservation tests failed for the missing policy before implementation, then parser/repository suites passed **24 tests** after implementation.
- `pnpm api -- gen:all` with the public example config and explicit loopback generation-only database placeholders: passed. Generated outputs were produced through the generator.
- Full API suite: **2550 passed, 112 skipped**, 195 files passed / 13 skipped. Existing opt-in/fixture skips remain; changed repository scenarios also run with embedded PostgreSQL and real PostgreSQL in the Worker smoke.
- API/contracts typecheck: passed. Web typecheck with the public fixture environment documented above: passed; the missing local Turnstile site-key warning is non-fatal.
- Full Web suite, sequential preparation with public fixture environment and `--maxWorkers=2`: **2559 passed, 3 skipped**, 225 files passed / 1 skipped. Existing fixture stderr includes `getaddrinfo ENOTFOUND api.test`; the process exited successfully without a failed-test/unhandled-error summary.
- Edge build with `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example`: passed as an offline dry run; no publication occurred. Scoped changed production API ESLint: passed with no output.
- Strict OpenSpec validation: **78 passed, 0 failed**. Existing informational notices remain.
- Production-domain HTTP smoke with `NEWSLETTER_SMOKE_DOMAIN=slax.app` and the same public Corepack archive: passed. Actual Worker GET/POST return code 409/address_reserved, a seeded stale binding remains blocked, and a mixed-case envelope reaches the application handler and receives its generic policy rejection with zero receipts. Normal slax.app delivery/deduplication/body reads and existing bookmark smoke flows also pass. This is entirely local and does not enable production.
- Default HTTP smoke with `--corepack-archive /tmp/slax-newsletter-pnpm.tgz`: passed. Actual local Edge/Core, historical PostgreSQL/logs/D1 migrations, Prisma transactions and local R2 proved that daguang@slax.dev can be issued, normal delivery deduplicates to one receipt/entry, Core reads the body, disabled/unknown recipients are rejected and existing bookmark/auth/CORS flows still work.

The smoke launcher now passes guarded `localDevOptions` into the installed Wrangler CLI directly. The former nested launcher created another empty Corepack home, bypassing the pre-seeded public pnpm cache and failing before Worker startup. The direct invocation retains local-only configuration validation, an isolated environment, short IPC paths and owned-resource cleanup. An initial production-domain fixture lacked Message-ID, so Miniflare rejected it before application dispatch; the fixture was corrected to ensure the test reaches the handler. These startup/fixture failures are not claimed as application acceptance.

### Local pre-push review

Bugs: checked full-domain/case handling, GET purity, POST idempotence, stale registry refusal, no R2/receipt/entry writes on policy rejection, stable issued addresses after rename, and retention of upstream smoke behavior during synchronization. Security: no new dependency, external service call, operator credential, private configuration copy or email-data logging is introduced by this revision; SQL remains parameterized and the reservation is enforced before MIME reading/storage. Compliance: implementation and configuration match `support-newsletter-feed`, the user's approved dev-first scope and the unchanged UI acceptance; operational work remains explicitly deferred. No Important finding remains from these three passes.

No new authored CLI, Extension or Mobile runtime/package behavior or consumed contract change results from this revision. Upstream changes synchronized from dev keep their original release/version decisions; no additional application version increment is needed here.

### Remaining operator acceptance

No hosted deployment, DNS/Email Routing mutation, production enablement, hosted PowerSync publication or real SMTP send was performed during this update. Start with dev only. After config/app deployment and sync readiness, the operator changes **slax.dev Catch-all: Drop -> Send to a Worker -> reader-backend**, preserving literal routes. The production Catch-all is not changed; the active daguang forwarding rule remains untouched. External delivery/confirmation, sender failure behavior and hosted cross-user sync isolation require the dev acceptance sequence. The local production-domain simulation does not prove hosted production routing or business forwarding.

Current guide: [Newsletter dev pilot](../../../docs/api/NEWSLETTER-DEV-PILOT.md). The root-domain guide supersedes historical exact-address instructions above; completed content and permanent reservations remain intact.


## Selected feed+ subaddress revision (2026-10-27)

### Requirements and implementation

The user explicitly selected fixed prefix feed and restored newsletterreader.slax.dev / newsletterreader.slax.com. Dev remains enabled in reviewed private configuration; beta/prod and the legacy main copy remain explicitly disabled. No hosted deployment or mail-routing mutation was made. This revision supersedes the root-domain plan rather than activating it.

Provisioning/rendering adds feed+ to the stable canonical account token stored in local_part. The token is scoped by domain, never recomputed after account rename, and never released on retirement. Eligibility is at most 59 ASCII characters so the full local part fits SMTP's 64-octet bound. Global account rules stay unchanged. Invalid long accounts are not truncated; oversized legacy stored tokens remain reserved and fail explicitly rather than exposing an invalid mailbox. No new schema, public DTO or environment variable is introduced.

Incoming mail requires the complete configured domain, feed+ and one valid non-empty account token. Bare feed, missing/wrong prefixes, extra plus details, whitespace, unknown and foreign-domain recipients are rejected before raw storage. The envelope is not URL-decoded again; local query builders encode plus as %2B. The previous root-address daguang reservation is removed because feed+daguang@newsletterreader.slax.com does not claim daguang@slax.app. Existing root mail services/forwarding and Catch-all rules remain untouched.

### Verification

- Regression-first Newsletter run: **11 expected failures / 15 passes** after changing address expectations and adding length/envelope scenarios, before implementing the format. After implementation: **26 passed** (parser 7 / repository-service 19). The failures demonstrated missing prefix rendering, old length eligibility and missing strict envelope parsing rather than fixture startup errors.
- Full API suite: **2552 passed / 112 skipped**, 195 files passed / 13 skipped. Existing opt-in and fixture skips remain. Embedded PostgreSQL exercises stable bindings, 59/60-character boundaries, legacy long-token reservation, mixed-case dispatch and no storage on invalid envelopes.
- Full Web suite with the public fixture environment above and --maxWorkers=2: **2559 passed / 3 skipped**, 225 files passed / 1 skipped. Existing fixture stderr includes ENOTFOUND api.test; exit status is zero. After normalizing the remaining copy/privacy fixtures to the final plus address, the address component suite separately passed **7 tests**, including literal plus-address copy behavior.
- API/contracts and Web typechecks passed. No site key is provided in the local Web fixture; its Turnstile warning remains non-fatal.
- pnpm api -- gen:all passed with public example configuration and loopback generation-only PostgreSQL/log placeholders. Generator outputs were unchanged; none were hand-edited.
- Edge offline dry-run build passed; changed production API ESLint passed with no output. Strict OpenSpec validation: **78 passed / 0 failed**. git diff --check passed.
- Default actual local HTTP smoke with the public Corepack archive: **passed** for newsletterreader.slax.dev. It provisions feed+ addresses for two users (including daguang), rejects nine invalid/bare/foreign envelopes with zero receipts, accepts mixed-case plus recipients, deduplicates the first delivery to one entry, publishes a separate second user's body, denies that user the first user's body, and preserves existing bookmark/auth/CORS/D1 smoke flows. Actual Edge/Core, full historical migrations, Prisma/PostgreSQL and local R2 run; only owned synthetic resources are created and cleaned up.
- Production-domain actual local HTTP smoke with NEWSLETTER_SMOKE_DOMAIN=newsletterreader.slax.com and the same public Corepack archive: **passed**, including both prefixed users, malformed/foreign rejection, duplicate suppression and cross-user body denial. No hosted production resource was activated.

### Review and acceptance scope

No Vue presentation, styles, labels, navigation or client API DTO changed. The original 2026-10-22 human acceptance remains recorded above for the unchanged setup/copy/reader UI; updated component fixtures verify the complete plus address is displayed/copied. Long-address/responsive checks and real provider behavior are also explicit hosted dev acceptance items, not claims of new human testing in this revision.

No authored CLI/Extension/Mobile logic, dependency graph or consumed contract changes are introduced; their versions need no increment. The private TOMLs were parsed and checked against origin/main: only the two approved Newsletter keys differ, and all unrelated bytes are identical after excluding those key lines. README and both operator guides explain the selected format and rollback.

### Independent and local pre-push review

The requesting-code-review reviewer independently inspected all 16 revised app/docs/spec/test files against 8f1375d4 in read-only mode and reported **no Important findings and no Nits** across Bugs, Security and Compliance. The parent also checked the private configuration's selected values and exact unrelated bytes. Review confirmed canonical token/rename preservation, the 59-character limit, strict envelope gating before MIME/R2, parameterized SQL, no new external calls/dependencies/PII logs, matching OpenSpec intent and scoped literal-route rollback. Production simulation was still running during the independent review and subsequently passed as recorded above. No excluded behavior was silently dropped: hosted routing, platform acceptance and sync isolation remain explicit operator work; unchanged visual presentation retains its earlier acceptance.

### Operator acceptance still required

No Cloudflare DNS/base-route/Subaddressing matching, real SMTP, hosted PowerSync publication/isolation or real Newsletter subscription was exercised locally. After deployment readiness, add the receiving newsletterreader subdomain in slax.dev, enable Subaddressing, and add only feed@newsletterreader.slax.dev -> reader-backend. Preserve existing Catch-all and literal/plus-detail rules. Test two actual plus recipients, bare/unknown detail rejection, real confirmation/content delivery and sender failure status. Later production setup must preserve root slax.com Feishu MX and slax.app business forwarding. Scope rollback to the pilot's literal route/admission; do not disable zone-wide Subaddressing if other routes depend on it.

See [current dev operator guide](../../../docs/api/NEWSLETTER-DEV-PILOT.md). Local injection bypasses Cloudflare routing and does not establish external platform compatibility; the guide explicitly requires representative real Newsletter tests.


### Final synchronization with dev f217f465

After the first subaddress push, dev merged PR #341 (local-first-ddl), making this PR conflict in sync_rules.yaml and powersyncRules.test.ts. The resolution preserves the complete upstream collection-owner DDL/rules and its current_user_id-anchored data-query pattern, retains RSS/Newsletter kind isolation and unchanged legacy RSS projection columns, and uses the same inline user/Lab/source scope for Newsletter rather than restoring the old joined CTEs.

- Generated artifacts were regenerated successfully from public example configuration; no tracked generated drift resulted. Final strict OpenSpec validation after synchronization passed **79 items / 0 failures**.
- Full API suite after synchronization: **2553 passed / 113 skipped**, 195 files passed / 14 skipped. The additional upstream collection integration suite remains opt-in. API/contracts typecheck passed. The merged PowerSync rule suite passed **14 tests**.
- `pnpm api -- test:setup:local --corepack-archive /tmp/slax-newsletter-pnpm.tgz`: **passed**. Actual disposable PostgreSQL applied the complete merged main/log migration set, then both local PowerSync services became healthy with the merged configuration and isolated dynamic ports. Its new optional archive flag seeds only the public package manager into the already isolated test home; no operator configuration or credentials are copied. The harness removed its own containers, volumes and temporary workspace. These health checks establish setup/migration readiness, not actual bucket authorization or parameter-result bounds.
- The previously recorded Web suites and production-domain prefix simulation remain applicable to their unchanged code surfaces. A fresh dev Worker HTTP smoke after the merged migration set **passed**, again exercising two-user plus delivery/isolation, deduplication, malformed/foreign envelope rejection and the existing authenticated bookmark flows.
- A second independent read-only review reported **no Important findings or Nits** for the conflict resolution: all three per-kind queries retain owner/Lab/source-kind gates; RSS columns and upstream owner tombstones are preserved. The parent accepted both review limitations: apply all merged migrations before rules, and do not infer actual bucket isolation/parameter-result bounds from source assertions, HTTP smoke or service liveness.

The operator guides now explicitly require both collection-owner migrations and Newsletter kind DDL before publishing rules, because a missing owner_deleted column can silently filter collection content even when PowerSync reports configuration loading. Hosted stream/bucket isolation and parameter-result counts for the merged joined feed queries remain explicit dev acceptance before wider rollout. Do not claim the upstream runtime parameter-count result establishes the new Newsletter query shape.


## REST-first revision (2026-10-27)

### Scope and requirement approval

The user explicitly approved removing Newsletter PowerSync for the initial rollout and revisiting it later. The revised proposal/design/delta specs describe the agreed boundary: Newsletter-enabled Feed reads both kinds through the existing authenticated REST facade, with one server ordering/cursor; RSS-only sessions preserve the established single-stream local-first implementation and REST fallback. Bookmark/collection synchronization is untouched. No new UI template, style, translation, navigation or API contract is authored in this revision; the human's pre-PR hands-on acceptance above continues to cover the unchanged presentation.

Removed `newsletter_v1`, its client subscription, Newsletter local presence gating, and multi-kind stream lifecycle/history plumbing. RSS history uses its existing `/v1/rss/entries` endpoint. The optional local `kind` column remains only to reject stale experimental Newsletter cache rows while accepting legacy null/missing RSS kinds. The generic REST kind helper no longer lives in the PowerSync reader. Entering Newsletter REST mode releases RSS's Feed subscription; returning to RSS-only restores it. Mode/account/Lab changes fence obsolete requests and previews. Newsletter has no promised new-session offline cache or incoming-mail push; online reload/explicit REST refresh obtains new content, and per-source in-memory cache reuse remains bounded by 60 seconds.

Receiving formats remain `feed+account@newsletterreader.slax.dev` / `feed+account@newsletterreader.slax.com`; production admission stays disabled. Private configuration values are unchanged in this revision: only its README is edited to remove Newsletter sync instructions. Operator guides distinguish RSS compatibility filtering from deferred Newsletter sync, remove the fictitious separate complete-address Dashboard field, and document deployment of the email handler before selecting the Worker. No merge, deployment or Cloudflare mutation was performed.

### Automated checks

- Regression-first Web run: **5 expected failures / 30 passes** before changing implementation. Four new cases proved that healthy/pending local storage incorrectly controlled Newsletter reads or account results; the fifth proved that RSS-only local history still used the generic Feed endpoint. After implementation, the focused two-file run passed **35 tests**. The final three-file REST/local regression run after type/import fixes passed **53 tests**.
- Full API suite, `pnpm api -- test`: **2553 passed / 113 skipped**, 195 files passed / 14 skipped. Existing opt-in/fixture skips remain. The rule suite asserts that Newsletter streams/Lab queries are absent while RSS source-kind filtering and legacy projection remain.
- Full Web suite with the public fixture environment recorded above and `--maxWorkers=2`: **2561 passed / 3 skipped**, 225 files passed / 1 skipped. The existing fixture `ENOTFOUND api.test` stderr remains non-fatal; process exit status is zero.
- API/contracts typecheck and Web typecheck passed. The first Web typecheck caught inferred FeedSubscription map types after restoring legacy RSS overlays; explicit RSS map types corrected this without changing runtime behavior. Scoped changed Web production ESLint passed after import sorting. No tracked generator-owned files changed.
- Strict OpenSpec validation: **79 passed / 0 failed**. Its first run required retaining the existing `Reload with local data` scenario name in the modified delta; its conditions now explicitly describe RSS-only sessions. `git diff --check` passed.

### Running-environment exercise

An isolated Vite/Vue browser harness at loopback port 3061 imported the actual modified `useRss`, RSS local-state, local-row reader and enablement modules. A headless Chrome session clicked rendered controls and inspected rendered state. Only the authenticated user/Labs, PowerSync query/stream boundary and REST server responses were synthetic. No provider credential or real user data was loaded. This is client data-flow runtime evidence, not hosted synchronization or a new human acceptance claim.

Observed results:

1. RSS-only startup showed the cached RSS article, excluded seeded stale Newsletter rows and subscribed only to `rss_v1`.
2. Enabling Newsletter with healthy local RSS unsubscribed that handle and fetched mixed REST subscriptions/entries without any Newsletter stream. Server order was preserved.
3. Load more expanded the REST window without duplicates; switching to the mail source cleared its old preview, and returning to All restored the expanded source cache.
4. Injecting a new fixture mail then explicitly refreshing showed the new first item while retaining the loaded history window.
5. Account B replaced A's REST subscriptions/entries and body state. Returning to RSS-only restored only the RSS stream; no browser page error occurred. Account ownership of a real replicated database was not simulated by this fixture.

Fresh `pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz` also **passed** against actual disposable Edge/Core Workers, PostgreSQL/log migrations, D1 and R2. It provisioned plus addresses, admitted isolated messages for two users, rejected malformed/unknown/foreign recipients before receipts, deduplicated replays, denied cross-user bodies, and preserved existing bookmark/auth/CORS flows. It used owned synthetic resources and cleaned them up. This run validates backend HTTP/email behavior independently of the client boundary fixture. No API handler changed in the REST-first revision.

### Remaining acceptance and operator work

Newsletter has no PowerSync publication/subscription acceptance step now. Before admitting shared-table mail rows, still publish/verify RSS-only compatibility filtering on every existing sync consumer, with upstream owner migrations completed before publishing the combined RSS/collection file. Hosted RSS parameter-result bounds and cross-user isolation are not established by static assertions or this browser fixture. Real Cloudflare subdomain/Subaddressing/base-rule matching, external SMTP and actual Newsletter platform confirmation/content delivery still require dev operator acceptance. Production remains off. The temporary browser service is stopped after verification; no local integration service is intentionally left running.

The English [dev operator guide](../../../docs/api/NEWSLETTER-DEV-PILOT.md), Chinese Desktop test guide and private configuration README have been revised together. Earlier dated stream-related evidence is historical and does not imply a Newsletter stream remains in this rollout.


### REST-first local pre-push review

The requesting-code-review reviewer independently examined the complete revision against `8f59762cfb5c47d62f6fafbbeabdcd47e3fc8eed`, then re-read the completed validation/operator evidence, and reported **no Important findings or Nits** in Bugs, Security or Compliance. The parent also checked stale-row exclusion, RSS-only legacy overlays/history, REST mode transitions and receipt/body ownership from the real HTTP exercise. The private repository's current diff contains README only; its approved TOML values are untouched. No dependency, covert external call, private-file read/copy, email-data log or weakened authorization was added. No newly authored CLI, Extension or Mobile shipped/package behavior or consumed contract change requires a version decision. Draft PR updates preserve their existing review/assignment state; the archive task remains deferred until merge.

## Approved review revision (2026-10-27)

### Scope and safety decisions

The user approved the revised plan and requested implementation in the existing worktree and PRs. This revision consolidates address GET into UserController and provisioning into user setting enable, stores immutable Newsletter platform bindings, adds a BIGINT receipt primary key while preserving UUID compatibility, and expands sources into physical sr_feed with old RSS write authority and transactional mirroring/backfill. The runtime registry is replaced; guarded legacy projections remain for old Workers. Source IDs and legacy client projections are preserved.

Review identified a gap in the requested cron removal: arbitrary Worker errors do not establish sender retries. The event now awaits publication and propagates failures, while cleaned HTML/metadata is staged as MIME readable by old processors. No new original EML or binary attachment is persisted. The bounded five-minute recovery and old receipt compatibility columns stay until SMTP evidence and drain permit a later simplification. Generic-only Newsletter orphan cleanup now removes entries/body references after subscription deletion.

Private config changes remove the obsolete boolean, retain the dev newsletterreader.slax.dev domain, and explicitly clear beta/prod/legacy-main domains. A byte-for-byte selected-key comparison confirms all unrelated TOML bytes remain unchanged. Explicit empty values are required because --keep-vars otherwise preserves omitted remote bindings. No private config, SMTP, DNS or remote database has been deployed/changed by this revision.

### Automated checks

- Regression-first tests reproduced synchronous failure being swallowed, pending duplicate non-resumption, strict cursor/unknown-anchor behavior, missing diagnostics, generic Newsletter orphan retention, zero-axis trackers and old address/projection gaps; fixes were verified GREEN.
- Full API suite: **2576 passed / 112 skipped**, 197 files passed / 14 skipped. Existing opt-in integration/sample skips remain; changed persistence also ran against native PostgreSQL below.
- Full Web suite with explicit public fixture configuration: **2566 passed / 3 skipped**, 225 files passed / 1 skipped. An earlier run without required public configuration failed two locale tests; the configured complete run supersedes it. A non-fatal existing api.test DNS diagnostic was printed without a failed/unhandled-error summary.
- Focused persistence/Feed/RSS/parser/PowerSync tests: **107 passed**, six files. Additional EML script tests pass; the content/parser/script focused run passed **17 tests**.
- gen:diff generated an unapplied index-name correction for the cloned Feed unique index; it is reviewed and retained as a separate migration. migration:local applied PostgreSQL and worktree-local D1/fulltext migrations using disposable PostgreSQL. gen:all regenerated Prisma/router/DI and runtime types; manually maintained Env bindings no longer contain the obsolete flag.
- API/contracts and clean Web typechecks passed. The first Web typecheck overlapped the temporary preview and picked up its plugin declarations; stopping the preview and regenerating normal Nuxt types resolved that cache contamination without product changes. Scoped API and Web ESLint have **0 errors** (existing any/unused/ignored-test warnings remain). git diff --check passed.
- Strict OpenSpec: **79 passed / 0 failed**. A task group numbering warning during documentation editing was corrected before the final validation.

### Native PostgreSQL migration exercise

PostgreSQL 17.6 ran in the owned disposable slax-newsletter-revision-pg container. A separate temporary database applied the actual old binding/RSS/Newsletter DDL and actual three revision migrations. Three independent clients attempted INSERT/UPDATE/DELETE while the migration held SHARE ROW EXCLUSIVE through trigger installation and backfill. pg_locks showed all three RowExclusiveLock requests ungranted and blocked by the migration connection. After commit all writers completed; exact old/new source row equality included lease, retry, history, metadata and timestamps, and the deleted row stayed absent.

Old UUID and new BIGINT receipt queries, new binding→old recipient lookup, old address→binding, owner-checked receipt joins, and both old/new retirement/delete paths passed. The temporary database was dropped. Detailed local report: /tmp/newsletter-postgres-race-report.md; only synthetic data was used.

### Running Workers and EML tool

The HTTP harness applied full historical PostgreSQL/logs/D1 migrations and ran actual local Edge/Core/R2. It passed authentication/bookmark smoke, settings-based address creation, exact prefixed addresses, malformed/foreign envelope rejection before receipts, mixed-case envelope matching, A/B body isolation, repeat Message-ID dedupe, and body reads. It additionally invoked the actual newsletter:test delivery command twice against Wrangler; one receipt/entry remained. This establishes local Worker dispatch/storage, not hosted SMTP/routing.

Synthetic offline EML preview produced HTML/text/report with CSP preventing external image/resource loads and a tracker removal report. Preview has no database/R2/network path. Real user EML was not yet supplied; keep it outside Git. The replay script permits localhost HTTP only, encodes plus with URLSearchParams and rejects redirects.

### Web and human acceptance

Actual components/composables ran in an isolated Nuxt fixture with synthetic HTTP data: 1440px light, 390px dark and 768px e-ink, reduced motion, keyboard Tab/Enter and clipboard. Each case exercised missing account → reserved account error → repair to alex → setting enable then read-only GET → exact feed+alex@newsletterreader.slax.dev copy. No address POST, page errors or document overflow. Preview displays attachment metadata and the no-file-storage notice. Temporary fixture repairs were outside product code.

On 2026-10-27 the user personally completed the prepared preview steps (reserved account error, alex repair, address creation/copy and attachment explanation) and answered “已操作，可以接受”. No further adjustment was requested. This renews acceptance for the changed setup flow; earlier acceptance alone was not reused.

### Review and remaining hosted work

Fresh independent Bugs/Security/Compliance review of the whole branch found no remaining Important findings or Nits. Earlier Important findings (zero-axis images, staged JSON being cancelled by old MIME processors, missing reverse address projection, and generic-only Newsletter orphan retention) were fixed with regression tests and scoped re-review. Change-id: support-newsletter-feed.

Not verified: hosted receiving DNS/base rule/Subaddressing, actual third-party Newsletter confirmation/content, the user's real EML, actual hosted PowerSync physical-table alias delivery/A-B isolation, and original sender SMTP retry after infrastructure failure. These need operator access or later input and are listed in docs/api/NEWSLETTER-DEV-PILOT.md. Existing recovery remains rather than assuming SMTP retry. No production activation, merges or remote migrations performed.

Version assessment: Web/API do not use package increments. CLI/Extension/Mobile source/dependencies/package output and their consumed RSS projection remain unchanged; the server table is aliased back to the same client name and fields. No application version bump is required for this revision.

### PR handoff and local cleanup

Application commit 9ca18131 was pushed to the existing feat/support-newsletter-feed branch and PR #349. Private configuration commit 23ffcf5 was pushed to the existing codex/enable-newsletter-dev branch and PR #7. Both descriptions now explain the final implementation, recovery gate, migration compatibility, dev console work and EML commands; the application screenshots show the latest selected subdomain and repaired setup/attachment UI. No new assignees or reviewer requests were added; existing human-owned review state is preserved. PRs remain unmerged.

The temporary UI/API preview listeners and owned revision PostgreSQL container were stopped/removed after acceptance. The managed worktree and all project data remain. Historical/full test artifacts and private preview files stay local; real EML is still awaited. Archiving remains a separate documentation PR after merge.

## No earlier Newsletter compatibility (2026-10-28)

The user confirmed that Newsletter has not merged/shipped and explicitly removed the requirement to support earlier versions of this PR. The unshipped migration history was consolidated into `20261022090000_newsletter_feed`. It directly creates platform-only receiving bindings and numeric `sr_newsletter_receipt.id`, with required `binding_id`/`payload_key`. It never creates an earlier Newsletter registry, UUID receipt column, legacy address mapping or bidirectional projection. The original production RSS migrations and source write mirror remain because RSS already ships.

Current recovery uses versioned JSON of parsed, cleaned HTML/metadata, preserving publication date and truncation without reparsing synthetic MIME. Old raw-prefix scans, synthetic MIME serialization and compatibility-only tests are removed. Active pending-delivery lease/retry/cancellation/deduplication and staged-payload GC remain. No Inbox save feature or UI was added.

### Verification

- New migration tests were RED against the previous migration (old registry still present and generic source absent), then GREEN after consolidation. They assert platform-only receiving ownership, direct numeric IDs, required current fields, owner validation, permanent retirement, and full existing-RSS source mirror/backfill/deletion behavior.
- Staged-content regression was RED when JSON was expected but synthetic MIME was persisted, then GREEN with parsed-content JSON. Focused API tests: **88 passed**.
- Full API: **2570 passed / 112 skipped**, 197 files passed / 14 skipped. Six removed tests existed solely for unsupported earlier Newsletter versions; permanent ownership and RSS compatibility remain covered.
- Actual fresh local Edge/Core/PostgreSQL/logs/D1/R2 HTTP smoke passed, including settings address creation, plus-safe EML replay/dedupe, two-owner isolation and private body reads. It applies the consolidated migration history from scratch rather than repairing or resetting operator databases.
- gen:diff produced only an empty migration, establishing model/SQL parity. The empty artifact and its disposable-database marker were omitted; migration:local and gen:all passed on the owned scratch PostgreSQL/worktree-local D1. API/contracts typecheck and scoped ESLint passed (0 errors, existing/ignored-test warnings remain). Strict OpenSpec: **79 passed / 0 failed**.
- Native scratch PostgreSQL introspection confirms no earlier address registry and direct bigint id, integer binding_id and text payload_key. No shared/remote database or operator environment file was read or reset.
- No Web presentation, public API contract or CLI/Extension/Mobile output changes in this delta. The prior accepted UI and Web evidence remain applicable; no repeated human UI acceptance is required for internal persistence cleanup.

### RSS Save to Inbox investigation

Production source trace: RssService.save → repository bookmark/user relation + save job → RssService.dispatchSaves → CrawlWorkflow → CrawlService.saveParseRes → MediaSnapshotService.capture → SnapshotBundle. A new unsaved URL creates an independent private HTML/text snapshot; it does not reuse the RSS entry content_key. Feed HTML and bookmark HTML can differ because RSS may provide an excerpt and acquisition fetches the original page. Existing successful same-owner/same-URL bookmarks reuse their saved record and skip a new crawl. Newsletter saving remains unimplemented; sharing a Feed object would require adapting snapshot reading/indexing and GC ownership, not just assigning the key.

### Documentation correction and remaining gaps

Restored unrelated private-config README deployment/recovery documentation accidentally removed by the prior unbounded section replacement. The Newsletter edit is now bounded by its section headings; no runtime TOML changes were needed. The operator guide now explains that existing local trial migration checksums require explicit local repair/reset with its owner; no such reset was performed automatically.

Hosted DNS/routing/Subaddressing, actual third-party Newsletter mail, the user's real EML, hosted RSS synchronization and original-sender SMTP failure retries remain unverified as previously recorded. Current recovery stays in place. No merge, deployment or remote migration performed.

### Current local pre-push review

A fresh independent reviewer checked Bugs, Security and Compliance for the current first-release simplification and reported **no Important findings or Nits**. The review covered the actual SQL/model and direct-ID queries, binding ownership/permanent retirement, JSON recovery/deduplication/GC, RSS compatibility and operator documentation. The private README was checked without opening TOMLs: its exact prefix before Newsletter rollout and suffix from Deployment access match the parent of the prior documentation revision, proving unrelated deployment/recovery instructions were restored intact.

The parent verified current test logs, scanned runtime/schema/migrations for removed Newsletter legacy fields, and corrected stale active-spec/guide wording. Historical dated records above remain as superseded evidence, not current rollout requirements. No application version decision is required: this delta changes internal API persistence only, with no CLI/Extension/Mobile contract, dependency or package-output change. Both existing PRs retain their assignment/review state; archive remains deferred until after merge.

## User real-EML acceptance (2026-10-28, Asia/Shanghai)

The user ran local API and Web from this Newsletter worktree, supplied a real EML privately, and accepted the resulting interface and content after hands-on testing. Their three screenshots at 10:07:03, 10:07:16 and 10:07:40 show the issued prefixed dev address with an empty Feed, a populated Feed containing the imported message, and the opened message body. On 2026-10-28 the user explicitly stated that the result met expectations and requested updating the original PR with these images. This is actual local integration acceptance in addition to the earlier component-fixture acceptance; it does not claim hosted SMTP or platform subscription acceptance.

### Local prerequisites and exercised path

- Read-only checks confirmed API at localhost:8787 and Web at localhost:3000 were running from this worktree. The local database's consolidated Newsletter migration checksum matched the current SQL and the old address table was absent; no reset was required or performed for this test.
- The supplied EML preview initially failed because a double-quoted shell path also contained literal backslash escapes. Removing the extra escapes made the actual preview command exit zero and generate HTML/text/report outside Git. Mail content/reports remain private; the original EML is not committed or uploaded.
- Enabling Newsletter initially returned HTTP 503 with `data.error=unavailable`. The effective local `[env.dev.vars]` table lacked NEWSLETTER_DOMAIN. Only that non-secret key was added to the ignored local api.toml, preserving all unrelated bytes; `pnpm api -- gen:all` exited zero. The operator restarted API and completed the accepted flow. The operator guide now documents the local-versus-private-deployment configuration distinction.
- User evidence covers address display, local EML delivery appearing in Feed, and readable message content. Newsletter Save to Inbox remains absent. These screenshots alone do not establish duplicate replay, attachment handling, tracking-image removal or cross-user isolation for this particular EML; prior synthetic automated evidence for those paths remains separate.

### Scope, screenshots and remaining gaps

The three user-authorized screenshots are attached to application PR #349 through GitHub media attachments, not stored in Git. The latest functional commit was already pushed as 1600a54b. This follow-up changes operator documentation and acceptance evidence only; it introduces no UI, API contract or application package-output behavior and is exempt from new runtime tests, renewed proposal and application version decisions. Strict OpenSpec validation and diff checks verify this documentation update.

A pre-existing uncommitted local PowerSync rules file exactly matches origin/dev rather than this feature branch: it removes the generic-source alias and RSS kind filters. No standard startup writer was found in the inspected setup/deploy scripts, and the author of an uncommitted overwrite cannot be established from Git. That file is preserved locally and excluded from this follow-up commit. The accepted Newsletter flow uses REST; it does not validate the branch's RSS compatibility rules. Hosted RSS alias delivery/A-B isolation and receiving DNS/base rule/Subaddressing, third-party subscription confirmation, and original-sender infrastructure-failure retries remain operator acceptance gaps. No merge, deployment or remote migration was performed.

## Production-domain preconfiguration (2026-10-28)

The user explicitly requested updating private PR #7 now so beta/main do not need another domain-only PR. Actual main releases consume api/prod.toml; beta, prod and the legacy main copy now set NEWSLETTER_DOMAIN to newsletterreader.slax.com. Dev remains newsletterreader.slax.dev. This replaces the previous empty-domain gate: after matching deployment a valid domain permits eligible user-Lab provisioning, while receiving DNS/Subaddressing/literal-route readiness and shared RSS isolation remain separate operational requirements. No new server boolean or activation mechanism is introduced.

All four TOMLs parse successfully and selected domain values match the approved environment mapping. Comparing each current file with HEAD after masking only NEWSLETTER_DOMAIN confirms every unrelated byte is unchanged; dev is byte-for-byte unchanged. Private credential values are neither printed nor copied into public artifacts. README changes are bounded to Newsletter rollout, with exact prefix/suffix preservation. Public implementation changes are documentation/spec only, and the pre-existing local PowerSync overwrite remains untouched and excluded.

Verification is limited to configuration syntax/value/byte-preservation checks, diff checks and strict OpenSpec validation; no runtime code, API contract, UI, CLI/Extension/Mobile package output or schema changes require rerunning the prior full suites or a version increment. Local pre-push Bugs/Security/Compliance review confirms the intended selected-key changes, no unrelated credentials/bindings edits, and consistent domain/admission semantics across current artifacts. Remote deployment, actual production SMTP and Cloudflare console mutations are not performed or claimed.

## Deferred automatic recovery — current revision (2026-10-28)

The user explicitly deferred recoverNewsletter and then rejected a follow-up cleanup migration because the feature PR has not merged. The current initial migration directly creates the reduced receipt schema; no additional migration is committed. Existing operator trial databases were neither reset nor repaired. Their already-applied migration checksum/schema will need a separate owner-directed fresh-database setup or local history/schema repair before testing this new revision.

### Implemented behavior and review scope

- Each email event parses its current MIME, synchronously stores the final Feed body and awaits publication. No parsed-content JSON, original EML or attachment binaries are staged for replay. The Newsletter cron class/registration, pending scans and staging garbage collection are removed.
- Receipts retain pending/done/cancelled deduplication and a 90-second per-event processing lease. Claiming requires a specific receipt ID; there is no batch recovery claim. Failed processing releases its lease and propagates failure. Another actual delivery or explicit local EML replay may resume pending work without consuming a second quota slot. An expired lease does not itself trigger processing. Infrastructure failure does not establish or guarantee original-sender SMTP retry.
- payload_key, retry_at, attempts and their recovery indexes are removed only from the Newsletter model and its unmerged initial DDL. All other PostgreSQL models match the preceding commit byte-for-byte. Shared scheduled jobs and shared final-body orphan collection remain. Cancellation/ownership fences, permanent bindings, quotas, RSS isolation, REST reads and the accepted UI remain unchanged.
- Change-id: support-newsletter-feed. A fresh independent Bugs/Security/Compliance review found no Important findings or remaining Nits after two wording corrections. The reviewer independently ran the 24 persistence/migration tests; the coordinator ran the broader checks below. No CLI/Extension/Mobile consumed contract, dependency, UI or package output changes; no application version decision is needed for this internal API revision.

### Automated and running-environment evidence

- Regression-first: final-body-only storage and failed-event redelivery tests failed against the prior implementation because a staged object remained, then passed after removal. Current focused command: `pnpm api -- test test/domain/newsletter/repository.test.ts test/infra/newsletterMigration.test.ts test/di/cronjob.test.ts` — **26 passed**, three files. Coverage includes actual-delivery resumption, no extra quota slot, active/expired lease fencing, cancellation, direct reduced schema and retained shared cron execution.
- Full API: `pnpm api -- test` — **2570 passed / 113 skipped**, 197 files passed / 14 skipped. Existing opt-in database/sample skips remain. One additional fixture skipped because an operator development listener already occupies 127.0.0.1:8686; the actual HTTP smoke below used isolated ports. The first complete run found a stale cron test expecting recoverNewsletter; its expectation was corrected and the full suite rerun successfully.
- Broad API/HTTP checks ran from an owned source export with this API diff and the branch's committed PowerSync rules. A pre-existing unowned local rules overwrite was preserved, not substituted into the tests or included in the commit. No operator secret/config files were exported. Initial startup was blocked by pnpm's unsafe task-state-path guard on a node_modules root symlink; after reviewing official pnpm guidance and four alternatives, real dependency containers with links to installed package entries were used in the export. No pnpm guard was disabled and operator dependencies were not changed.
- `pnpm api -- test:http --corepack-archive /tmp/slax-newsletter-pnpm.tgz` — **passed** against actual isolated local Edge/Core Workers, fresh PostgreSQL/logs/D1/R2 and fresh migrations. Auth/bookmark smoke, settings address setup, malformed/mixed-case plus recipients, two-owner isolation, private body reads and duplicate synthetic EML replay exercised the real handler. The same EML delivered twice retained one receipt/entry. This is local event injection, not hosted SMTP acceptance.
- Required generation workflow ran in order with an owned disposable PostgreSQL database and the public configuration template: `gen:diff` produced only an empty migration (omitted after inspection), `migration:local` and `gen:all` exited zero. Native scratch introspection found **zero** removed Newsletter recovery columns and retained the unrelated payment attempts column. An earlier create-only generation check caught an accidental payment-model field removal from a broad edit; every non-Newsletter model was restored before rerunning successfully. No corresponding payment migration was created or applied. Generator output includes the pre-existing non-fatal stale newsletterController discovery warning; no router/controller behavior changed in this revision.
- API/contracts typecheck passed. Scoped ESLint: **0 errors / 2 ignored-test warnings**. Maintained changed TypeScript was formatted; generated registrations changed only through gen:all. `git diff --check` passed. Strict OpenSpec: `pnpm exec openspec validate --all --strict` — **79 passed / 0 failed**.

### Acceptance and remaining operational work

The prior 2026-10-28 real-EML human acceptance and its three authorized PR screenshots remain applicable because this delta changes no UI. The real private EML was not replayed or uploaded again. Earlier full Web/type/theme/responsive evidence remains scoped to the unchanged presentation.

Hosted DNS/base-route/Subaddressing, actual Newsletter platform SMTP delivery and confirmation, hosted RSS alias/A-B isolation, and original-sender retry after infrastructure failure remain unverified because they require hosted/operator acceptance. Recovery removal is now an explicit accepted scope decision, not a claim that SMTP retry was proven. Old local trial staging objects are no longer scanned; no operator objects were deleted. Keep shared Cloudflare cron triggers because unrelated jobs use them. This removal needs no new Cloudflare console configuration. No merge, deployment, hosted migration or active operator database mutation was performed.
