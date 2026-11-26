# Expose library search at narrow widths

## Context

The shared top-bar search is hidden at widths up to 860px. This makes a frequent library action difficult to reach in a phone browser or embedded Web view.

## Goals / Non-Goals

Expose a labeled compact search action at the narrow breakpoint and reuse the existing search input and results flow.

## Decisions

At compact widths replace the hidden entry with a labeled button that reveals and focuses the same search input. Provide a clear dismissal action that returns focus. Reuse the current bookmark search, avoiding a separate mobile results implementation.

## Risks / Trade-offs

Sequence after scope-web-search-history; use the same search surface and history policy.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
