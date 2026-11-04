# Tasks

PR #509 completed the earlier implementation but the owner rejected its new receipt API after merge. This checklist supersedes the earlier backend design and tracks the explicit simplification on `fix/share-recovery-use-exists`. Acceptance remains focused automated tests and bundle only; no UI redesign, device testing, or native build. Retain version 1.0.28/build800/previous799.

## 1. Remove unnecessary backend scope

- [x] 1.1 Remove receipt controller/domain/repository additions, optional Twitter signal changes, and receipt-specific API tests; regenerate registrations with `pnpm api -- gen:all` and verify the API tree equals its pre-#509 baseline.
- [x] 1.2 Update iOS fallback to call existing `/v1/bookmark/exists` and require HTTP200 plus complete JSON boolean `data.exists: true`; verify false/invalid/missing/nonboolean/status cases, three-second body deadline and cancellation with focused Swift host tests.
- [x] 1.3 Update Android fallback to the same existing endpoint and JSON predicate, retaining total deadlines and diagnostic ownership; verify body stall/partial response, errors, cancellation, auth/origin/URL and single-query counts with focused Kotlin host tests.

## 2. Verify and deliver the correction

- [x] 2.1 Regenerate authoritative iOS copies through the existing share plugin, verify version metadata unchanged, and confirm no receipt endpoint/method remains in runtime source (a negative test assertion forbids the removed route).
- [x] 2.2 Run relevant native-language host/unit tests and the dual-platform bundle; record exact results without expanding to native builds, devices, or extra runtime fixtures.
- [x] 2.3 Complete Bugs/Security/Compliance review, strict OpenSpec validation and diff checks; commit and push the correction, create follow-up PR #513 targeting dev, and leave merge/deployment/publication to the owner.
