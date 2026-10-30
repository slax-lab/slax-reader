# Proposal: Add KOC bloggers

## Why

The promotion registry needs profiles for Yiang, Corina, Hope Seventeen, Sen, Sidereal Education, Chloe, and Sen's LinkedIn and Substack identifiers so their promotion links return blogger information and accept their activity IDs through the existing subscription claim flow. The first four profiles have landed; Sidereal Education, Chloe, and Sen's two additional platform identifiers extend this same change before archival.

## What Changes

- Register `yianggao`, `corina`, `hopeseventeen`, `senl`, `siderealedu`, `chloemanilay`, `senlinkedin`, and `sensubstack` with their supplied display names and avatar URLs.
- Use each registry key as its activity ID.
- Preserve existing entries, response formats, claim eligibility, and Turnstile verification.

## Capabilities

### New Capabilities

- `blogger-promotions`: Specify registry-backed lookup and activity validation for the eight additional KOC bloggers.

### Modified Capabilities

None.

## Impact

- `apps/api/src/handler/http/promotionController.ts`: eight additional static registry records across the change, with `senlinkedin` and `sensubstack` added by the latest follow-up PR.
- Existing `/v1/promotion/blogger_info` and `/v1/promotion/receive` routes recognize the additional identifiers without route or contract changes.
- No dependencies, migrations, configuration, or environment variables are added.
