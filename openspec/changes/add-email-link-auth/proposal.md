# Proposal

## Why

Email-code and Passkey authentication are already implemented. Phase three lets readers use the same login email to follow a sign-in link, including opening the App when supported, without replacing the existing authentication or account-linking flows.

## What Changes

- For reserved `@internal.invalid` login addresses, extend the separately requested code-only backend log with the generated login link; do not call Resend. Ordinary login proof values remain absent from logs.
- Login emails contain both the existing six-digit code and an HTTPS sign-in link. Both expire together after five minutes; successfully consuming either invalidates both. Mailbox-binding emails remain code-only.
- Reuse `POST /v1/user/email/send` and `POST /v1/user/login`; add a typed email-link proof to the latter. Sending does not reveal the link secret to the requesting client.
- Add a small Web email-link landing flow and native cold/warm URL handling. A supported installed App receives the link first; otherwise the HTTPS page completes Web login.
- Keep the current account when a link opens in an authenticated client. Explain that the reader must sign out and reopen the email link; do not consume the proof or switch accounts automatically. This is the session rule confirmed by the change requester.
- Extend the existing website/App associations to handle only the email-login entry path, preserving Passkey associations and current signing trust.

## Capabilities

### New Capabilities

- `email-link-authentication`: email delivery, one-time link authentication, native handoff, Web fallback, and current-session preservation.

### Modified Capabilities

None. The additive capability depends on the implemented `add-email-otp-auth` and `add-passkey-auth` changes; it does not duplicate their still-active delta files or change OAuth callback requirements.

## Impact

- Contracts: extend `packages/contracts/src/email-auth.ts`; retain `RESTMethodPath` as the only HTTP route registry and retain existing responses.
- API: extend `UserController` → `UserService` → `EmailCodeService` → `EmailChallengeRepo` / Resend. Successful proofs reuse `loginByVerifiedEmail`, existing account ownership policy, and session completion.
- Web: one public email-login page, focused URL parsing/lifecycle code, existing `useAuth` session completion, and narrowly scoped startup/routing handling.
- Mobile: focused auth controller/hook and React Native Linking adapter wired at composition; existing typed API transport and session controller; Expo-owned link configuration.
- Infrastructure: existing Upstash Redis, Resend, `FRONT_END_URL`, and public association files. No Prisma migration, PowerSync change, new service, dependency, HMAC secret, rollout switch, or new certificate trust.
- This proposal is planning only. Implementation follows human review; the UI demo offer and hands-on acceptance follow `DESIGN.md` before dependent implementation and PR delivery respectively.

## Review Status

The change requester approved implementation on 2026-11-18 and chose to proceed directly from the reviewed proposal. Mobile version 1.0.33 (808), previous build 807, is authorized. Implementation starts from dev at `1e821fc5`; hands-on acceptance and the requested independent Codex/Claude Opus 5.5 reviews are required before delivery.

On 2026-11-18 the change requester split internal log delivery into a code-only backend Draft PR (#661), followed by link logging in this feature PR. The feature incorporates that prerequisite and adds only the link to the existing internal log line. Public association support #660 has merged and preview publication has been verified.

After accepting the Web flow and the exercised signed iPhone flows, the requester explicitly authorized opening the feature Draft PR before complete Android acceptance: Android will be verified using a Play Beta package. This is a task-specific adjustment to the normal pre-PR acceptance order, not an Android pass or a change to repository policy. Do not add debug certificate trust to work around that deferral.
