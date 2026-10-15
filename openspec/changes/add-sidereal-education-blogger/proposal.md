# Proposal: Add Sidereal Education as a KOC blogger

## Why

The promotion registry does not include Sidereal Education, so its promotion link cannot resolve blogger information or use its activity ID in the existing subscription claim flow.

## What Changes

- Register `siderealedu` with the supplied display name and avatar URL.
- Use `siderealedu` as its activity ID.
- Preserve existing entries, response formats, claim eligibility, and Turnstile verification.

## Capabilities

### New Capabilities

- `blogger-promotions`: Specify the registry-backed Sidereal Education KOC blogger profile and activity validation.

### Modified Capabilities

None.

## Impact

- `apps/api/src/handler/http/promotionController.ts`: one additional static registry record.
- Existing `/v1/promotion/blogger_info` and `/v1/promotion/receive` routes recognize `siderealedu` without route or contract changes.
- No dependencies, migrations, configuration, or environment variables are added.
