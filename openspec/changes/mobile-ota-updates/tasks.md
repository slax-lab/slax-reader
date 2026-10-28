# Tasks

## 1. Integration

- [x] 1.1 Install SDK 58-compatible `expo-updates`; verify `pnpm install --frozen-lockfile`.
- [x] 1.2 Configure `app.config.ts` (`runtimeVersion: nativeVersion`, `updates` URL, `ON_LOAD`, `fallbackToCacheTimeout: 0`, `production` channel header; disabled for fixtures and non-production origins) and the `production` channel in `eas.json`; add a configuration test.
- [x] 1.3 Regenerate the native projects with operator inputs and run pods; verify the generated update metadata and that nothing else changed.
- [x] 1.4 Add `update:publish` and document publishing, eligibility, rollout, rollback, quota and policy limits.

## 2. Verification

- [x] 2.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `openspec validate --all --strict` and `git diff --check`.
- [x] 2.2 Build and launch a production Release iOS simulator build; record the embedded updates configuration and that startup is unaffected.
- [ ] 2.3 After the first OTA-capable build is delivered, publish a staged update to `production`, confirm a device applies it on the next cold start, and confirm update-download metrics in EAS Observe.
- [x] 2.4 Record evidence and declared gaps in `validation.md`.

## 3. Archive

- [ ] 3.1 Archive this change in a follow-up docs pull request after the task pull request merges.
