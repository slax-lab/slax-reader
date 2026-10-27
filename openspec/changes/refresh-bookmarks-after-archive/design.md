# Design

## Context

The reader uses bookmark UUIDs. REST list rows expose `bookmark_user_uuid`; local rows use the UUID as `id`. The existing archive channel uses legacy numeric identifiers. Local lists use reactive database queries; REST lists append pages to an array.

## Goals / Non-Goals

Preserve the list during recovery and prevent responses from an obsolete account or filter from updating it. Preserve local writes as the local source of truth. No periodic polling, layout change, sync-engine replacement, or database migration.

## Decisions

- Add a scoped archive message to the existing channel. Keep legacy messages compatible. Use the existing account-key helper; never transmit tokens.
- Publish after the archive write succeeds and only while the initiating session remains current. Do not change shared request behavior.
- On an archive message, invalidate the current personal bookmark list. REST mode can remove a matching UUID immediately, then refresh its loaded pages. Local mode refreshes the watched query and retains database ownership of state.
- Recheck on focus, visibility return, and cached-page activation. Combine duplicate events and serialize refreshes. No background timer polls.
- Reuse the REST list query with an explicit page argument. Collect the loaded range before replacing the displayed array. Keep current items on errors. Reject responses after account, filter, or list-generation changes.
- Keep subscriptions and search outside this personal-list correction. Their distinct membership rules do not mean that archiving removes an article.

## Risks / Trade-offs

- A paginated REST refresh sends one request per loaded page. Foreground event coalescing and one active refresh bound duplicate work.
- Local refresh cannot create server changes that have not synchronized. Existing PowerSync delivery remains authoritative; refresh must never overwrite pending writes.
- Shrinking a list can clamp the browser scroll position. Avoid clearing the list or explicitly scrolling to the top.
- Real Safari worker behavior requires separate device evidence. Synthetic tests cannot establish server synchronization latency.

## Migration Plan

Deploy the Web bundle through the normal release workflow. No data migration is required. Reverting this change restores the prior behavior.
