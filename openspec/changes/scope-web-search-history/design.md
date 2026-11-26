# Keep recent searches private to the active account

## Context

The search bar stores five terms in one origin-wide key. An isolated Chrome run showed the prior terms after an identity change and reload.

## Goals / Non-Goals

Restore history for the verified current account and clear the visible list immediately on identity changes.

## Decisions

Namespace recent terms by the established stable Web account key. Ignore and remove the unowned legacy list because it cannot be attributed to a reader. Clear the old view before loading the next account. Preserve the five-term limit and per-account Clear action.

## Risks / Trade-offs

Sequence after fix-web-search-result-order. The last successful login email is a separate specified convenience preference.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
