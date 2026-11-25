# Distinguish processed rows from a completed import

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The progress modal can render Processing (100%) because its percentage measures processed rows while the task status is still active.

## What Changes

- Use a finalizing label when all rows are accounted for and the task is active. Only a confirmed terminal status may indicate completion.
- When an active task has 199 of 200 rows processed, the progress display still distinguishes it from a fully processed batch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-library-import-feedback` — Distinguish processed rows from a completed import.

## Impact

apps/web/app/components/ThirdPartyImport/ImportProgressModal.vue and useImportTasks.ts.

Sequence after explain-web-import-file-errors. No assumption about the duration of backend finalization.

[ImportProgressModal.vue](../../../apps/web/app/components/ThirdPartyImport/ImportProgressModal.vue) · [useImportTasks.ts](../../../apps/web/app/composables/useImportTasks.ts)
