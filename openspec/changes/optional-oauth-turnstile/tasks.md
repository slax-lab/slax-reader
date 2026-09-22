## 1. Configuration contract

- [ ] 1.1 Update Web and shared environment schemas so Google OAuth is non-empty required while Apple OAuth and Turnstile are optional.
- [ ] 1.2 Update `tooling/preflight.mjs` and its tests to label Google as `（必填）`, Apple and Turnstile as `（可选）`, and preserve blocking versus informational severity.

## 2. Optional provider behavior

- [ ] 2.1 Hide Apple login controls in the login page and modal when the client ID is absent or empty, while retaining the configured flow.
- [ ] 2.2 Make invitation login, promotion receive, and payment setup skip Turnstile rendering and token waits when the site key is absent or empty.
- [ ] 2.3 Add or update focused component tests for Apple visibility and the disabled/enabled Turnstile branches.

## 3. Documentation and validation

- [ ] 3.1 Update `apps/web/.env.example` comments with Google Cloud Console creation steps and the frontend redirect/origin guidance.
- [ ] 3.2 Update Web development and contributor documentation with required/optional classifications and the Google OAuth creation process.
- [ ] 3.3 Run Web unit tests, preflight tests, strict OpenSpec validation, diff checks, and the three local review passes.
