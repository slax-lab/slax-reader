# Tasks

## 1. API fix

- [x] 1.1 Remove the native-equals-Web client rejection from the `GoogleAuth` constructor in `apps/api/src/utils/authLogin/authGoogle.ts`, keeping the empty-client rejection; verify with `pnpm api -- test` passing
- [x] 1.2 Update `apps/api/test/utils/googleNativeAudience.test.ts` to the shared Web/iOS/Android client topology, and add cases for shared-client acceptance and empty native client rejection; verify the new cases fail before 1.1 and pass after

## 2. Validation

- [x] 2.1 Run `pnpm api -- typecheck` and `openspec validate --all --strict`, and verify both pass
