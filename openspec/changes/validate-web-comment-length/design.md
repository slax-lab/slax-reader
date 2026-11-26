# Explain the comment length limit before submission

## Context

The reader keeps Send enabled at 1,501 characters while the existing write contract rejects values longer than 1,500 UTF-16 units. Queue blockage is a historical observation and has not been reproduced on this release.

## Goals / Non-Goals

Show a localized length error and block invalid new comments and replies before either local or direct submission. Retain the draft for correction.

## Decisions

Use the same length measure as the existing write contract. Apply it after the same normalization as submission on all Web composition paths. Allow over-limit paste for correction, expose feedback to assistive technology, and guard both Enter and button submission.

## Risks / Trade-offs

No existing queued-data repair is assumed. Validate both local-first and REST writers.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
