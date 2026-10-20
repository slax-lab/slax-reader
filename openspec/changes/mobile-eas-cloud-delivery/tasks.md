# Tasks

## 1. EAS cloud delivery

- [x] 1.1 Add the dev-only workflow with mobile/shared path filters and `EXPO_TOKEN`.
- [x] 1.2 Add the preflight comparison and EAS configuration, Android, share-target and archive validation.
- [x] 1.3 Gate EAS on Mobile CI and submit iOS and Android builds with `--no-wait`.
- [x] 1.6 Add `--auto-submit` so EAS submits finished builds with the `production` submit profile (TestFlight, Play internal); update the workflow-contract test and the CI and Mobile release documentation.
- [x] 1.4 Add workflow-contract tests and update the CI and Mobile release documentation.
- [x] 1.5 Record the separate delivery intent in the active `expo-mobile-migration` change.

## 2. Delivery verification

- [x] 2.1 Run `node --test tooling/ci-scope.test.mjs tooling/ci-workflow.test.mjs`, the preflight simulation, and `openspec validate --all --strict`.
- [ ] 2.3 Confirm on EAS that the next dev build bump produces a TestFlight upload and a Play internal-track release.
- [ ] 2.2 Archive this change in a follow-up after the task PR merges.
