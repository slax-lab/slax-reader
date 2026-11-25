# Resume an unexpired email sign-in challenge

## Context

The Web code form lost both its six-digit field and its running resend timer after a refresh or a modal remount in Chrome.

## Goals / Non-Goals

Restore a live challenge on the original sign-in surface in the same tab. Let readers change the email or start again after expiry.

## Decisions

Store the email, challenge ID and absolute expiry/resend deadlines in a separate session-scoped entry keyed to the login purpose and continuation. Do not store the code or token. Reuse the active host's redirect and attribution. Invalidate on change of address, successful authentication or expiry. Binding and last-successful-email prefill have different purposes.

## Risks / Trade-offs

Coordinate with email/passkey flows. Keep the existing remembered-address preference and authentication limits.

## Verification

Use the affected Web entry point in a running browser and record the observed result for each scenario.
