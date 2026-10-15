# Proposal: Add KOC bloggers

## Why

The promotion registry needs profiles for Yiang, Corina, Hope Seventeen, Sen, and Sidereal Education so their promotion links return blogger information and accept their activity IDs through the existing subscription claim flow. The first four profiles have landed; Sidereal Education extends this same change before archival.

## What Changes

- Register `yianggao`, `corina`, `hopeseventeen`, `senl`, and `siderealedu` with their supplied display names and avatar URLs.
- Use each registry key as its activity ID.
- Preserve existing entries, response formats, claim eligibility, and Turnstile verification.

## Capabilities

### New Capabilities

- `blogger-promotions`: Specify registry-backed lookup and activity validation for the five additional KOC bloggers.

### Modified Capabilities

None.

## Impact

- `apps/api/src/handler/http/promotionController.ts`: five additional static registry records across the change, with only `siderealedu` added by the follow-up PR.
- Existing `/v1/promotion/blogger_info` and `/v1/promotion/receive` routes recognize the additional identifiers without route or contract changes.
- No dependencies, migrations, configuration, or environment variables are added.
