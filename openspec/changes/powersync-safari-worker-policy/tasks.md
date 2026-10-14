# Tasks

## 1. Platform policy and initialization

- [x] 1.1 Add worker-policy regression tests covering iPhone/iPod/iPad/Android, a truthy Safari marker, desktop Chrome/Edge/Firefox, missing SharedWorker, and absent browser globals; verify the new behavior fails before the helper is implemented.
- [x] 1.2 Implement the small platform-policy helper using the installed SDK's checks and document its upstream version/source; verify the platform matrix passes without importing SDK internals or adding dependencies.
- [x] 1.3 Wire the helper into the production plugin's recovery selection and add plugin-boundary tests that exercise the worker-enabled path, assert the actual first mode and database options, retain the database identity, and avoid policy-triggered clearing; verify Safari selects dedicated, eligible desktop selects shared, and development retains main-thread initialization.

## 2. Recovery regression and validation

- [x] 2.1 Extend dedicated-first recovery coverage for initialization timeout, cleanup timeout/error, and definite failure with successful cleanup; verify REST remains the outcome for uncertain cleanup and main-thread fallback remains possible after safe cleanup.
- [x] 2.2 Run the local-first test suite (including extension-bridge authentication), Web typecheck, and lint for changed source/tests; verify results and identify any unrelated baseline failures explicitly. Run `openspec validate --all --strict` and `git diff --check` successfully.
- [x] 2.3 Record production-mode browser validation: when iPhone Safari and an eligible desktop session are available, confirm the initial recovery mode and observe a remotely saved bookmark with the phone in the foreground. If device access is unavailable, record that limitation and a precise reproduction checklist without claiming a measured latency fix.
