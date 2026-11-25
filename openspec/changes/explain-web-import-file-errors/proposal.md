# Explain an unsupported import file type

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

Selecting an existing .txt file for Pinboard shows the same message as a missing file, although the client already knows the filename and accepted extensions.

## What Changes

- Name the unsupported format and list the selected importer's accepted types. Keep the file picker available for immediate correction.
- When a supported valid export is chosen immediately afterward, the format error clears and the preview opens.

## Capabilities

### New Capabilities

- `web-library-import-feedback` — Explain an unsupported import file type.

### Modified Capabilities

None.

## Impact

apps/web/app/components/UserImportSection.vue and the en/zh Web import messages.

First of the two web-library-import-feedback proposals.

[UserImportSection.vue](../../../apps/web/app/components/UserImportSection.vue)
