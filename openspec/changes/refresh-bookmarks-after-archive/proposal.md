# Proposal

## Why

Archiving an article in another tab can leave it in the home Inbox indefinitely. The REST reader sends no archive notification, and returning to the list does not refresh its data.

## What Changes

- Notify open lists after successful archive and unarchive actions, using the account identity and bookmark UUID.
- Refresh affected REST lists without clearing their loaded pages, filters, or scroll position.
- Recheck list data on foreground return and cached-page activation, combining duplicate checks.
- Refresh local queries without writing remote state over pending local changes.
- Test notifications, foreground recovery, pagination, failed requests, and account changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync`: Keep bookmark lists current after archive changes across tabs and foreground return, including REST fallback.

## Impact

Web reader archive actions, bookmark list data, the existing message channel, and focused tests. No API contract, dependency, database schema, Extension, CLI, or Mobile changes.

## Human review

On 2026-10-28, Luca approved the preceding conversation proposal and requested implementation, tests, and a commit after successful tests. This document records that approved scope. This is a state-correction fix with no material layout or navigation change. Human hands-on acceptance remains required before a pull request opens.
