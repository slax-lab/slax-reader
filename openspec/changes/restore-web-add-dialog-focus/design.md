# Return keyboard focus when the Add dialog closes

## Context

The audit observed focus on body after Escape from Add at 390 × 844. The closing handler hides the dialog without restoring the invoking control.

## Goals / Non-Goals

Return focus to the specific opener after dismissing the Web library Add dialog.

## Decisions

Capture the invoking element at open time and focus it when the closing transition completes. If a successful submission intentionally navigates away, honor the destination's normal focus management. Support each existing dismiss action.

## Risks / Trade-offs

Sequence after add-content-tabs establishes the content-addition capability.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
