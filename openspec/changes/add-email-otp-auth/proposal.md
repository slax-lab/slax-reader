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


## Sequenced Follow-up: refine-email-login-flow

PR #584 and the original authentication task have merged. On 2026-11-12 the change requester requested the sequenced `refine-email-login-flow` follow-up: Web methods ordered Google, Apple, email; a quieter email entry/link action; last-successful-address prefill; non-repeatable successful verification during departure; and development/preview/beta Web availability with production hidden and App unchanged. The preceding rollout/order statements record the earlier delivered scope. The reconciled delta specs describe the proposed follow-up target; its implementation tasks, approval, and new hands-on acceptance belong to `refine-email-login-flow`. Keep single ownership of these capability deltas and archive them together after that follow-up merges.


The App-unchanged wording in the original Web follow-up records that phase's scope. After Web hands-on acceptance, the change requester separately reviewed and approved native provider-first order and quieter email entry/binding in `refine-email-login-flow`. Only that presentation exclusion is superseded; native development-only availability, credentials, sessions, and persistence remain unchanged. Native requirements remain solely in the `email-authentication` delta.
