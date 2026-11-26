# Distinguish processed rows from a completed import

## Context

The progress modal can render Processing (100%) because its percentage measures processed rows while the task status is still active.

## Goals / Non-Goals

Use a finalizing label when all rows are accounted for and the task is active. Only a confirmed terminal status may indicate completion.

## Decisions

Use raw current_count and batch_count for the finalizing decision. Avoid rounding a partial batch up to 100%. Continue the existing polling until the supplied task state is terminal. Keep success and failure counts visible.

## Risks / Trade-offs

Sequence after explain-web-import-file-errors. No assumption about the duration of backend finalization.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
