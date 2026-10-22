# Validation

## Environment and scope

Branch `feat/support-newsletter-feed`, based on `origin/dev` `4fa9ff08`, in a new Codex-managed worktree. No remote deployment, DNS, Email Routing, private configuration edit or remote database mutation has been performed. Synthetic local resources were created and removed by the HTTP smoke harness. A subsequent user-requested local integration environment applied the additive Newsletter migration to the existing local development PostgreSQL database and initialized worktree-local D1/R2 state. Existing operator configuration is loaded through normal application startup; secret file contents were not printed or copied by the agent.

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

- **Not deployed to slax.dev.** Matching real Edge/Core PostgreSQL/R2 bindings, private CI configuration, live hosted PowerSync rule publication and Cloudflare exact address rules require the dev release/operator sequence.
- **No real external SMTP test.** Local email dispatch and application rejection are verified; sender bounce/delivery status and Cloudflare's behavior on an infrastructure failure before durable admission require a dedicated dev test. Post-admission publication recovery is covered locally.
- **No hosted PowerSync acceptance.** The separate local server replicated successfully and the user accepted local integration testing, but hosted rule publication and explicit cross-user/kind isolation with real synchronization remain dev rollout checks before expanding the pilot.
- Newsletter source management/automatic unsubscribe/Inbox save/attachments are deliberately absent. Subscribed mail has no 30-day expiration; monitor storage and pending-receipt age. The retry batch is capped at five per five-minute tick.

Operator steps and human test cases: [Newsletter dev pilot](../../../docs/api/NEWSLETTER-DEV-PILOT.md). Beta/main admission stays off until all shared-database readers and sync rules have RSS kind isolation.
