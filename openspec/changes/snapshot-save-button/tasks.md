# Tasks

## 1. Review and implementation

- [x] 1.1 Obtain human review of this proposal before implementation and record the decision in `proposal.md`; verify the recorded scope covers labels, star states, no trailing checkmark, and preserved saved-state behavior.
- [x] 1.2 Register `snapshot.save` and `snapshot.saved` using existing curated SVG assets, render them through `AppIcon`, and regenerate the registry with `pnpm icons:write`; verify `pnpm icons:check` and `pnpm icons:test` pass.
- [x] 1.3 Restyle `SnapshotForkButton.vue` and update the scoped Chinese/English save labels and feedback; verify the rendered state mapping and run the existing `useBookmarkFork.spec.ts` tests without altering admission, retry, or account/source isolation.
- [x] 1.4 Document the save-state icon mapping in `DESIGN.md` and index runtime asset usage in `docs/design/README.md`; verify links resolve, the runtime source/size/paint/accessibility metadata matches the documented mapping, and `pnpm design:check` passes.

Implementation and agent-check results, including the blocked Nuxt unit suites and baseline lint failures, are recorded in `validation.md`. Checked verification items mean the checks were attempted and their actual results documented, not that every check passed.

## 2. Verification and delivery

- [x] 2.1 Exercise the actual rendered action and adjacent `/b/[id]` header at desktop, 768px/769px, 380px/381px, and 320px in Chinese/English and light/dark/e-ink; record unsaved, pending, saved, unavailable, failed/retry, focus, and reduced-motion evidence in `validation.md`, and resolve any scoped layout defects.
- [x] 2.2 Run Web lint, typecheck, relevant existing tests, build, icon/design checks, and `openspec validate --all --strict`; record commands, results, and any concrete agent-verification gaps in `validation.md`.
- [x] 2.3 Prepare the running environment for human hands-on acceptance, implement and reverify requested adjustments, and record who accepted, when, and what changed before opening a PR.
- [x] 2.4 Complete all three local `REVIEW.md` passes, resolve Important findings, and prepare the repository-template PR against `dev` with `OpenSpec: snapshot-save-button` and links to the evidence; verify the diff remains Web-only and record the package-version exemption.
- [ ] 2.5 After the task PR merges, classify every remaining unchecked task and archive the change through a separate docs PR; verify the resulting living specification and strict OpenSpec validation.

The owner accepted the implementation after local testing and supplied both screenshots on 2026-10-27. The three local review passes are complete, and the PR description includes the acceptance, verification limits, and screenshot attachments. Item 2.5 is deferred until the task PR merges.
