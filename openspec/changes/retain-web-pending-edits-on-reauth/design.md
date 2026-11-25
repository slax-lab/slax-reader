# Recover pending library edits after session expiry

## Context

A renamed bookmark appears immediately in the library. The reported same-account re-login restored the old title. The production client calls clearAuth on an upload 401 and can then disconnect and clear its local database.

## Goals / Non-Goals

When authentication interrupts a local upload, tell the reader that edits await sign-in. Resume that owner's pending changes on verified same-account return.

## Decisions

Distinguish an expired session from intentional sign-out at the point that owns database reset. Suspend the existing queue, hide its rows while signed out and compare its existing owner stamp with the authenticated identity before reconnecting. Keep ordinary logout and account-switch cleanup.

## Risks / Trade-offs

Sequence after fix-deferred-reader-takeover for web-local-sync. Retest the cold-start 401 path covered by fix-expired-session-cold-start.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
