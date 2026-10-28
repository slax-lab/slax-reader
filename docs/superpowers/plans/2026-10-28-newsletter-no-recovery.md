# Newsletter Without Background Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove automatic Newsletter recovery from the unmerged first release as explicitly requested by the user.

**Architecture:** Parse and publish within each incoming event. Keep receipt state and a short lease for concurrent-delivery and cancellation fences; retain no replay body, retry timer or attempt count. A new delivery supplies its own MIME and may resume pending work.

**Tech Stack:** TypeScript, Cloudflare Workers/R2, Prisma/PostgreSQL, Vitest/PGlite.

**Spec:** openspec/changes/support-newsletter-feed/specs/newsletter-feed/spec.md and design.md.

## Global Constraints

- Edit the unmerged initial feature DDL directly; no new migration and no automatic local reset/repair.
- Preserve 5 MiB / 200 sources / 200 new messages per UTC day, account ownership, permanent addresses and RSS isolation.
- No Newsletter PowerSync or Save to Inbox; no UI changes.
- Keep other scheduled jobs and shared final-body garbage collection.

## Review Focus

- Failure after admission must propagate and keep one pending receipt without a stored recovery body.
- Duplicate delivery must resume pending work and publish once without another quota slot.
- An active lease must reject competing processing; expired leases must allow actual redelivery.
- Disable/re-enable and deletion must prevent late publication.
- Schema cleanup must leave final content/identity behavior intact on a fresh database.

### Task 1: Synchronous receive and schema cleanup

**Files:** domain/newsletter.ts, infra/repository/dbNewsletter.ts, handler/cron/newsletterJob.ts, prisma/pgsql.prisma, the initial Newsletter SQL and newsletter tests under apps/api.

**Interfaces:** NewsletterRepo.admit(recipient, source, message) has no payload argument; claim(id: bigint) only claims that delivery; release(receipt, cancel) clears processing state without scheduling. NewsletterService processes ParsedNewsletter from the current event.

- [x] Add/run RED assertions for final-body-only storage and failed-event redelivery.
- [x] Remove the Newsletter cron class and temporary payload path; simplify repository/schema/initial SQL.
- [x] Verify pending/duplicate/expired-lease/cancellation cases and migration columns with regression tests.
- [x] Run gen:diff → migration:local → gen:all on an owned disposable PostgreSQL database; omit an empty generated migration.
- [x] Run full API/types/scoped lint and a real isolated Worker smoke without touching the operator's active services/database.

### Task 2: Review and PR handoff

**Files:** existing operator guides, OpenSpec evidence/tasks and private README; original PRs #349 and #7.

- [x] Synchronize no-recovery behavior and explicit SMTP uncertainty; retain accepted UI screenshots.
- [x] Obtain a fresh Bugs/Security/Compliance review and fix Important findings.
- [x] Push existing branches/update original PR descriptions without changing reviewer/assignment state.
- [x] Leave archive for a separate documentation PR after merge.
