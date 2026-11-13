# Tasks

- [x] 1. Define additive contracts, model/migration, typed repository ports, challenge repository and protocol verifier with focused tests.
- [x] 2. Integrate minimal HTTP challenge/list routes, existing login/setting/session flow, summary consistency and account cleanup; regenerate DI/router/types and exercise local PostgreSQL/Redis/Workers.
- [x] 3. Extend approved Web login/account components and existing session guards; verify locales, themes, widths and virtual-authenticator flows.
- [x] 4. Extend native Mobile adapters, focused feature hooks, API methods, configuration and association templates; run host/type/bundle/native compile checks.
- [x] 5. Complete Claude Code opus-5.5 boundary review and independent Codex regression review after all implementation; verify and resolve concrete findings.
- [x] 6. Record verification and operator gaps, record Web/iPhone acceptance and the requester-directed Android deferral, inherit dev version 1.0.31 (806), and create a Draft PR to dev.

- [ ] 7. Sync dev `293847be`, preserve #597 email interactions and rollout, verify the Release test-domain Passkey surface, compare actual signing identity, and prepare/test the operator-signed Android package.

Task 7 status: dev synchronization, regression checks, actual signer comparison and signed test APK preparation are complete. Android native execution is deferred by the requester until Beta (2026-11-13), so this task is not marked passed. Do not update #592's certificate trust for the skipped local attempt.

Delivery: Draft PR https://github.com/slax-lab/slax-reader/pull/607 targets dev. Supporting PR #592 is closed at the requester's direction. Task 7 retains the explicitly deferred Android native verification; archive follow-up must classify that gap after merge.
