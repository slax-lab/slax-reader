> REST-first scope update (2026-10-27): Newsletter PowerSync is deferred by the user. Newsletter-enabled Feed uses authenticated REST for both kinds; RSS-only sessions keep existing local-first reads. No newsletter_v1 stream or client subscription ships. Retain RSS kind isolation to protect existing clients. Earlier Newsletter sync instructions below are historical; the current OpenSpec design and dev operator guide take precedence.

> Routing decision updated on 2026-10-27: the user selected feed+account@newsletterreader.slax.dev for dev and feed+account@newsletterreader.slax.com for production. Use one literal feed route with Cloudflare Subaddressing. Earlier exact-per-user and root Catch-all notes below are historical; see docs/api/NEWSLETTER-DEV-PILOT.md for current operator instructions.

# Newsletter and Feed implementation plan

Execute openspec/changes/support-newsletter-feed/tasks.md in the isolated feat/support-newsletter-feed worktree. The reviewed feasibility document is background; the change proposal/design/specs are the implementation contract.

1. Add schema and migration, permanent address registry and case-insensitive account-setting transaction. Test against embedded PostgreSQL, including conflicts, rename, retirement and repeated provision.
2. Independently add RSS kind isolation and Feed facade/contracts/PowerSync; use database ownership, Labs and cursor tests. Keep legacy Mobile interfaces unchanged.
3. Add pinned bounded MIME parsing, receipt-backed email acceptance, synchronous opportunistic publication plus leased cron recovery. Test duplicates, parser attacks, R2/DB failures, quotas and disable/delete races.
4. Integrate Web with both data kinds, separate streams, setup/address form and safe reader. Exercise component tests and real browser states using existing design tokens.
5. Generate code from sources, run relevant checks, perform bug/security/compliance review and record running evidence. Present the approved dev newsletterreader.slax.dev receiving subdomain, Subaddressing and literal feed route test plan; preserve root mail services and daguang@slax.app forwarding, and keep production admission disabled pending its separate rollout. Human UI acceptance is required before PR; remote resources and production activation are separate operator steps.
