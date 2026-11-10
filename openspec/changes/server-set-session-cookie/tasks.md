# Tasks

## 1. Implementation

- [x] 1.1 Add `POST /api/auth/session` with the exact Origin check, JWT-shape check, `no-store`, and the existing cookie scope; verify with `tests/unit/server/authSession.spec.ts`.
- [x] 1.2 Route `/api/auth/session` through the Pages Function; verify the built `dist/_routes.json` includes it.
- [x] 1.3 Persist login and daily refresh through the endpoint; an endpoint failure fails login and keeps the cookie on refresh; verify with the updated `useAuth` and user store specs.

## 2. Verification

- [x] 2.1 Run `pnpm web -- test`, `pnpm web -- typecheck`, ESLint on changed files, `pnpm web -- build`, and `openspec validate --all --strict`; record results in `validation.md`.
- [x] 2.2 Exercise login, refresh, logout, and endpoint failures in Chrome against the built Pages worker; record cookie attributes in `validation.md`.
- [ ] 2.3 In beta, confirm Cloudflare security rules do not challenge `POST /api/auth/session`.
- [ ] 2.4 On beta, sign in with Google in Safari and confirm the login cookie expires in about 60 days; record the result in `validation.md`.
- [x] 2.5 Complete the `REVIEW.md` local pre-push review before pushing.
