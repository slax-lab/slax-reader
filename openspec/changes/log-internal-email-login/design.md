# Design

## Context

See proposal.md. The existing call chain is UserController → UserService → EmailCodeService → EmailChallengeRepo / Resend. UserService already supplies a normalized email key.

## Goals / Non-Goals

Change login delivery for one reserved domain. Keep account policy, mailbox binding, transport responses and persistence untouched. Login links are outside this PR.

## Decisions

- Keep the exact `@internal.invalid` suffix in `const/emailCode.ts`. Select log-only delivery in EmailCodeService for login purpose only; do not add a provider abstraction, endpoint or environment switch.
- After existing limits and Redis challenge save succeed, use the existing console logging convention to emit one line with email and code. Skip the Resend call and its key requirement only on this branch. Keep ordinary delivery/rejection handling unchanged.
- Test real behavior through the existing domain suite and HTTP smoke. Redis remains owned by infra; no new commands or Lua.

## Risks / Trade-offs

The internal code is an active login credential in backend logs. This is the explicitly requested exception for reserved internal test addresses only; ordinary addresses and binding codes are never logged by this branch. The existing five-minute expiry, attempt guards and single consumption still apply. No extra environment restriction is introduced.

## Migration Plan

Normal API release; no migration or operator configuration. Reverting this branch restores ordinary delivery for internal addresses. Continue the separately owned email-link feature after this Draft PR is delivered.
