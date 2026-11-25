# Keep search results attached to the active query

## Context

In a Chrome component run, a failed Images search retained Rust rows. A late Rust success also replaced three JavaScript results with two Rust results under the JavaScript heading.

## Goals / Non-Goals

Keep rows, count, loading and errors tied to the latest search. Provide an in-place retry for the current input.

## Decisions

Use a request generation local to the results view. Ignore obsolete success, failure and finally handlers. Render an explicit failed state with a retry action and distinguish it from a successful empty result. Use the existing request layer without showing raw transport text for this search.

## Risks / Trade-offs

First of the three web-library-search proposals. The retrieval and ranking contract remains owned by owned-bookmark-search-filtering.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
