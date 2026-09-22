# Design

## Context

The Web environment schema currently declares all three public provider fields as strings, while the UI renders Apple and Turnstile controls unconditionally in several flows. The existing preflight check also treats the three fields as declaration-only placeholders. See `proposal.md` and `specs/web-auth-and-antibot-configuration/spec.md` for the desired contract.

## Goals / Non-Goals

**Goals:**

- Make the environment schema and preflight severity reflect the actual provider requirements.
- Derive Apple and Turnstile availability from the public runtime configuration in one place per affected component.
- Preserve current provider behavior when optional values are configured.
- Keep the existing request paths and payload shapes so backend integration can be completed independently.

**Non-Goals:**

- Adding or changing backend validation, OAuth consent configuration, or Cloudflare account resources.
- Moving OAuth client secrets into frontend configuration; only the public Google client ID belongs in the example file.
- Disabling Google login when the optional providers are unavailable.

## Decisions

1. **Use an explicit schema distinction.** `GOOGLE_OAUTH_CLIENT_ID` becomes a non-empty string requirement. Apple and Turnstile become optional strings; an empty value from `.env.example` is treated as disabled by the UI. This preserves the existing app-local dotenv loader and avoids introducing a second feature flag.
2. **Gate controls at the rendering boundary.** Login page and modal render Apple only when the runtime value is non-empty. Turnstile widgets are rendered only when the site key is present. Each flow also gates its token-dependent action on the same boolean so a missing widget cannot leave an action permanently disabled.
3. **Continue the existing downstream path without a token.** When Turnstile is disabled, invitation and promotion requests keep their current payload keys with an empty token, and payment setup calls its existing client-secret request immediately with an empty token. This leaves backend policy and endpoint contracts outside this frontend change.
4. **Represent optional fields in preflight.** Google is labeled `（必填）`; Apple and Turnstile are labeled `（可选）` and produce informational output when absent or empty. Preflight must continue to omit all values from output.
5. **Document Google creation in the tracked example and Web guide.** The instructions use Google Cloud Console, OAuth consent setup, Web application client type, `PUBLIC_BASE_URL` as an authorized JavaScript origin, and `${AUTH_BASE_URL}/auth` as an authorized redirect URI. They explicitly say to copy only the client ID and never a client secret into the frontend env file.

## Risks / Trade-offs

- [Risk] A backend that still requires Turnstile tokens will reject requests from a frontend with Turnstile disabled. → The frontend keeps the request shape stable and the documentation will describe Turnstile as a deployment-level optional feature; backend policy must be aligned when backend integration is implemented.
- [Risk] A stale Apple callback URL could still be opened manually even when the button is hidden. → The normal UI exposes no Apple entry point; a later backend/auth hardening change can reject disabled provider callbacks without affecting this frontend contract.
- [Risk] Google client IDs are public but still environment-specific. → The example contains only placeholders and the guide warns contributors not to place client secrets in frontend files.

## Migration Plan

1. Update schema, preflight metadata, components, tests, and Web documentation in one change.
2. Run Web unit tests and preflight checks with Google configured and Apple/Turnstile both empty, then with each optional provider enabled.
3. Roll back by reverting the change commit; existing configured Apple and Turnstile deployments continue to use their current flows.
