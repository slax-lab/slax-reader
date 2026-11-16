# Design

## Context

See proposal.md for the approved scope. The page is client-rendered. BookmarksLayout hides its sidebar at 769–920px; the promotion itself is hidden at 768px and below. The image therefore needs eager loading only at 921px and above.

## Decisions

Use the existing VueUse `useMediaQuery('(min-width: 921px)')` in the page and bind both localized images to `eager` or `lazy`. Preserve the default fetch priority by omitting `fetchpriority`. An unconditional eager attribute would also fetch hidden narrow-screen images; a new image component or shared abstraction is unnecessary for this single placement.

## Limitations

This removes only the native lazy-loading wait after DOM insertion. Database initialization, identity checks, eligibility requests, and overall historical LCP are not changed or claimed to improve by a particular duration. Validate the effective initial attribute and the narrow-screen behavior with a browser fixture; full account-flow verification remains separate.

## Rollback

Restore both attributes to static `loading="lazy"` and remove the page-local media query.
