# Tasks

## 1. Preserve article nodes

- [x] 1.1 Add failing hydration regressions against the actual component, including complete own SSR output, original text/image identity, changed/empty initial values, CSR, real refresh/clear/remount and processed-node preservation.
- [x] 1.2 Implement component-local SSR-aware guarded HTML ownership without changing processor order or article presentation.

## 2. Attribute first-byte delay

- [x] 2.1 Add fixed-name access/metadata and warm HTML delivery timing regressions, including production omission, access denials and unchanged serialized metadata.
- [x] 2.2 Extend existing optional timing plumbing and diagnostic headers without query/concurrency/cache-policy changes.

## 3. Image cache and cover stability

- [x] 3.1 Add and pass regressions for eligible R2-hit edge fill and retained signature/Referer/MIME/RSS/Range/video behavior.
- [x] 3.2 Add and pass capture regressions for exact-cover positive dimension pairs, preserving authored sizing and unrelated images.

## 4. Verification and handoff

- [x] 4.1 Exercise running browser hydration, highlights, image previews and native podcast play/jump/resume; record results and explicit gaps.
- [x] 4.2 Run affected automated checks, API generation as required, strict OpenSpec validation and Bugs/Security/Compliance review; address Important findings.
- [ ] 4.3 Record any required application version decision and human hands-on acceptance before PR delivery.

## 5. Post-deployment outcome

- [ ] 5.1 After human deployment, verify candidate build/cache convergence and controlled end-to-end budget before the final outcome window.
- [ ] 5.2 Judge the existing seven-day podcast/Mole 70% contract with sufficient family/canary counts and matched traffic mix; keep insufficient or failing outcomes open.

See `validation.md` for completed local checks and explicit integration/device/performance gaps. Task4.3 remains open for current-branch human acceptance; Web/API require no package-version increment. The owner's explicit November 13 request authorizes an early draft PR while that acceptance remains pending. Tasks5.x are human-controlled deployment and post-convergence field verification, not local implementation claims.
