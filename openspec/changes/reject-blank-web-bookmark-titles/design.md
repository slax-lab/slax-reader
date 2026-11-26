# Prevent whitespace-only bookmark titles

## Context

The library list passes editingTitle directly to the local writer or REST mutation, and a spaces-only alias wins the display fallback.

## Goals / Non-Goals

Reject whitespace-only renames with an inline explanation. Allow correcting the title without losing the previous one.

## Decisions

Validate the proposed value at the Web edit boundary before writing or updating the visible row. Preserve any established explicit reset-to-original action. Fall back to the source title when rendering an existing whitespace-only alias, without bulk rewriting saved rows.

## Risks / Trade-offs

Covers Web editors and display. The search index for aliases is outside this change.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
