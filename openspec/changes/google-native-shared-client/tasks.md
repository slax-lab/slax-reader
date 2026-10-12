# Tasks

## 1. API fix

- [x] 1.1 In `apps/api/src/utils/authLogin/authGoogle.ts`, verify `aud` against the server client for all platforms and native `azp` against comma-separated per-platform app client lists, with a constructor guard for empty lists or lists containing the server client; verify with `pnpm api -- test` passing
- [x] 1.2 Rewrite `apps/api/test/utils/googleNativeAudience.test.ts` for the production topology (server `aud`, app `azp`, multiple Android clients) with acceptance, wrong-presenter, wrong-audience, misconfiguration and Web cases; verify the native cases fail against the previous implementation and pass after 1.1

## 2. Validation

- [x] 2.1 Run `pnpm api -- typecheck`, `pnpm api -- lint` and `openspec validate --all --strict`, and verify they pass

## 3. Rollout

- [ ] 3.1 Set beta `GOOGLE_IOS_CLIENT_ID_TEXT` to the iOS app client and `GOOGLE_ANDROID_CLIENT_ID_TEXT` to the three Android app clients, deploy, and verify Google sign-in on a real iOS and Android device against beta
