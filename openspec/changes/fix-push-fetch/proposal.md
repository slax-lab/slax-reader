# Proposal

## Why

Configured quality and failure cards do not reach their notification groups because Cloudflare Workers rejects `fetch` with `redirect: 'error'`. A captured test-environment invocation completed screenshot and AI validation, then failed at this fetch option before sending its card.

## What Changes

- Use Workers-compatible manual redirect handling for Feishu topic cards, Feishu report cards, and WeCom notifications.
- Reject redirects and unsuccessful HTTP responses without following another destination or including webhook URLs or response bodies in the new errors.
- Preserve notification payloads, environment tags, and local/unconfigured suppression.
- Add regression coverage for each notification channel and verify the transport in a local Worker runtime.

## Capabilities

### New Capabilities

- `notification-delivery`: Workers-compatible outbound notification transport that preserves configured destinations and existing message formats.

### Modified Capabilities

None.

## Impact

- API notification transport in `apps/api/src/infra/external/slaxAlertBot.ts` and its tests.
- No dependencies, API contracts, application package versions, database bindings, moderation configuration, or workflow retry policies change.
- Database configuration is being handled separately by the operator. This PR does not deploy Workers or send live test notifications.
