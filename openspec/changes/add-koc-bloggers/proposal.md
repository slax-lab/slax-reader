# Proposal: Add KOC bloggers

## Why

The promotion registry does not include Yiang, Corina, Hope Seventeen, or Sen. Their promotion links need to return blogger information and accept their activity IDs through the existing subscription claim flow.

## What Changes

- Register `yianggao`, `corina`, `hopeseventeen`, and `senl` with their supplied display names and avatar URLs.
- Use each registry key as its activity ID.
- Preserve existing entries, response formats, claim eligibility, and Turnstile verification.

## Capabilities

### New Capabilities

- `blogger-promotions`: Specify registry-backed lookup and activity validation for the four additional KOC bloggers.

### Modified Capabilities

None.

## Impact

- `apps/api/src/handler/http/promotionController.ts`: four additional static registry records.
- Existing `/v1/promotion/blogger_info` and `/v1/promotion/receive` routes recognize the additional identifiers without route or contract changes.
- No dependencies, migrations, configuration, or environment variables are added.
