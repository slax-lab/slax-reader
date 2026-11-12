# Proposal

## Why

Slax Reader currently requires Google or Apple to create an account or sign in. Add passwordless email codes so new readers can join directly and existing readers can add email access to their existing account.

## What Changes

- Offer email-code registration and login on Web, iOS, and Android. Browser extensions continue to launch Web login and use the existing session handoff.
- Let Google and Apple users sign in normally and bind a verified mailbox from account settings. Let email-first users link Google and Apple explicitly from account settings where the provider is supported. Use the same existing user ID across linked methods.
- Initially show Web email authentication UI in development and preview, and native Mobile UI only in development: login-page and modal entries, code forms, and the entire new account sign-in methods section, including mailbox/provider linking actions and linked identity status. Beta and production keep the original Google and Apple login entries. Email sending, login, and authenticated binding APIs remain available in every environment with email credentials configured.
- Use `sr_platform_bind` with `platform=mail` for verified login emails. Keep the existing `platform=email` mail-collection behavior and preserve legacy profile email values.
- Deliver codes with Resend from `Slax Reader <noreply@reader.slax.com>`. Keep short-lived challenges and send limits in the existing Upstash Redis integration.
- Add one email delivery route. Reuse the existing login, account settings, user information, and provider binding initiation routes.

## Capabilities

### New Capabilities

- `email-authentication`: Email-code registration and login, explicit identity linking, and account-safe integration with the existing session flow.

### Modified Capabilities

None.

## Impact

- API, shared contracts, Web login and settings, and native Mobile login and settings.
- Existing PostgreSQL models, Redis, and Resend. This phase requires no PostgreSQL schema migration.
- This is the first of three sequential feature pull requests. Passkey and email-link sign-in are separate changes that build on the account and session behavior introduced here.

The Web test-profile clarification was explicitly requested and reviewed on 2026-11-12 as part of `polish-web-sign-in-methods`. It expands Web visibility to preview without changing Mobile or API availability. Keep this capability's delta here rather than duplicating it in the presentation change.
