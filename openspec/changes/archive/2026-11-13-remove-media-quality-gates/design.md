# Design

## Context

See proposal.md. Podcast runs validate each part and the assembled article. YouTube uses keyed passages plus a second assembly repair layer. Both share article quality helpers; caption admission also uses independent heuristics.

## Goals / Non-Goals

Remove online content judgments while preserving runnable data, empty-output recovery, checkpoint reuse and execution safety. Do not change the model, article identity, database schema, rendering contract, moderation or authorization.

## Decisions

- Delete heuristic classifiers and content-driven repair branches instead of weakening thresholds or adding bypass flags. The sole content rejection is emptiness.
- Keep parseable typed data and keyed translation mapping because assembly depends on them. Cue references and order are not publication gates; existing best-effort timing calculation remains.
- Keep source-owned YouTube passage IDs; remove final semantic and reference scoring and assembly regeneration. Empty passage recovery and provider truncation splitting remain bounded.
- Caption admission uses only nonempty source presence. Keep eligibility response decision/reason shape; do not expose invented quality scores.
- Keep only count-based generation telemetry, request outcomes and explicit empty/parse errors. Do not log raw content.

## Risks / Trade-offs

- Model inaccuracies can be published: this is the user-approved behavior; improve prompts with offline samples rather than reinstating heuristic gates.
- Source references can be imperfect: existing timing assembly uses available references without discarding text.
- Historical skipped/failed rows are not mass-requeued; owner retry remains available. Existing successful checkpoints are reused without re-evaluating content.

## Migration Plan

Deploy the task PR through the existing human-managed workflow. No schema or environment changes. Revert the code commit to roll back. PR #537 is merged; archive sequencing for that earlier capability delta remains a separate docs task.
