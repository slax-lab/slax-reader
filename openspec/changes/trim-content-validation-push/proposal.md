# Proposal

## Why

The Content Validation card sent to the operations group includes every parser comparison plus the AI confidence and evidence list. Routine cards are long and hard to scan even though operators only act on the issue type, the AI description, the overall parse completeness, and the screenshot preview.

## What Changes

- Trim the Content Validation result card to title, URL, AI issue type, AI description, a one-line parse quality summary, and the screenshot preview link.
- Present the parse quality summary as `综合完整度 <percent>% （来自<parser>）` using the selected parser, and keep the existing unavailable-score explanation when no score exists.
- Remove the AI confidence and AI evidence fields from the result card.
- Keep issue classification gating and bookmark step events unchanged.

## Capabilities

### New Capabilities

- `content-validation-alerts`: Concise Content Validation result cards for the operations notification group.

### Modified Capabilities

None.

## Impact

- API result-card assembly in `apps/api/src/entry/edge/workflows/contentValidationWorkflow.ts` and the quality summary formatter in `apps/api/src/utils/articleQualityScoring.ts`, with their tests.
- No notification transport, AI prompt, schema, API contract, or application package version changes.
