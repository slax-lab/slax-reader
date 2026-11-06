> Historical planning checkpoint (2026-10-22), superseded by the current [OpenSpec design](../../../openspec/changes/support-newsletter-feed/design.md) and [dev operator guide](../../api/NEWSLETTER-DEV-PILOT.md). Earlier schemas, routing, recovery and synchronization steps below are retained as decision history and MUST NOT be used as current implementation instructions.

# Newsletter and Feed implementation plan

Execute openspec/changes/support-newsletter-feed/tasks.md in the isolated feat/support-newsletter-feed worktree. The reviewed feasibility document is background; the change proposal/design/specs are the implementation contract.

1. Add schema and migration, permanent address registry and case-insensitive account-setting transaction. Test against embedded PostgreSQL, including conflicts, rename, retirement and repeated provision.
2. Independently add RSS kind isolation and Feed facade/contracts/PowerSync; use database ownership, Labs and cursor tests. Keep legacy Mobile interfaces unchanged.
3. Add pinned bounded MIME parsing, receipt-backed email acceptance, synchronous opportunistic publication plus leased cron recovery. Test duplicates, parser attacks, R2/DB failures, quotas and disable/delete races.
4. Integrate Web with both data kinds, separate streams, setup/address form and safe reader. Exercise component tests and real browser states using existing design tokens.
5. Generate code from sources, run relevant checks, perform bug/security/compliance review and record running evidence. Present the approved dev newsletterreader.slax.dev receiving subdomain, Subaddressing and literal feed route test plan; preserve root mail services and daguang@slax.app forwarding, and keep production admission disabled pending its separate rollout. Human UI acceptance is required before PR; remote resources and production activation are separate operator steps.
