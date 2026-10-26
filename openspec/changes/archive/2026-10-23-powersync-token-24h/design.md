# Design

## Context

See proposal.md for motivation. The signer currently uses separate clock reads for `iat` and a relative five-minute expiration. Web and mobile clients already derive credential validity from the signed expiry.

## Goals / Non-Goals

**Goals:** Issue a credential lasting 24 hours minus one second, staying strictly below PowerSync's maximum signed lifetime.

**Non-Goals:** Change login sessions, client cache policy, signing keys, or authentication admission.

## Decisions

- Read the current Unix time once, rounded down to whole seconds. Set `iat` to that value and `exp` to that value plus 86,399. This retains the requested one-second margin and avoids separate relative clock reads changing the signed lifetime across a second boundary.
- Use a generated in-memory RSA test key and verify the actual signed token, including acceptance before expiration and rejection at expiration. Keep private test material out of files and logs.
- Retain existing claims and response fields. Both clients use the server's signed `exp`. Update the mobile diagnostic's expected issuance to 86,399 seconds separately from its 24-hour cache ceiling; preserve expiry handling for previously issued credentials.

## Risks / Trade-offs

- Longer credential validity delays natural expiration of an already issued credential after session revocation. This is the requested lifetime; existing signing-key rotation and admission checks remain in place.
- The [official JWT requirements](https://docs.powersync.com/configuration/auth/custom) specify a maximum `exp - iat` of 86,400, although an older paragraph on the same page mentions 60 minutes. Target the explicit requirements and validate service compatibility during the separately authorized deployment.

## Migration Plan

Deploy the backend through its existing release process. Existing five-minute credentials expire normally; subsequent acquisitions receive credentials lasting 24 hours minus one second. Reverting the signer restores five-minute issuance but does not shorten already issued tokens. This PR does not deploy services.
