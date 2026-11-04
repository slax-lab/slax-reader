# Tasks

## 1. Review and regression

- [x] 1.1 Obtain human review of proposal.md and record approval before product-code edits; verify the accepted scope includes recovery of existing empty copies.
- [x] 1.2 Add failing regressions for div/main/sibling fragments, full documents, script/style/noscript removal, and existing empty destination text; verify the reproduced fragment cases fail on the baseline.

## 2. Implementation

- [x] 2.1 Share saved-HTML text extraction and use it during Fork publication; verify destination text and word count reflect the copied body while existing article fixtures remain valid.
- [x] 2.2 Recover existing empty conventional HTML text at the shared read boundary using only the matching saved destination HTML; verify chat, outline, and overview receive recovered text, nonempty/PDF/legacy reads are unchanged, missing content fails as before, and no write or external fetch occurs.

## 3. Verification and delivery

- [x] 3.1 Run focused and full API tests, lint, typecheck, build, and required API generators; inspect generated diffs and record actual command results in validation.md.
- [x] 3.2 Exercise new Fork and existing empty-copy AI requests in a running local API with deterministic provider fixtures; verify all three consumers receive saved destination text and record external-provider/production gaps explicitly.
- [x] 3.3 Run openspec validate --all --strict and the Bugs/Security/Compliance review from REVIEW.md; resolve Important findings and record the selected change-id and evidence.
- [x] 3.4 Assess shipped CLI/Extension/Mobile impact and ask for affected version decisions if required before commit/push/handoff; if the final fix is API-only, record why no shipped app version decision applies. Prepare delivery on fix/fork-ai-content without deploying remotely.
- [x] 3.5 After the task pull request merges, classify remaining unchecked tasks and archive through a separate documentation pull request; verify the archive contains the final snapshot-ai-text contract. Task PR #490 merged into `dev` at 2026-11-03T10:52:44Z; the post-merge archive evaluation classified every remaining task and archived the change as `2026-11-03-fork-ai-content`, and the living `snapshot-ai-text` capability carries both requirements and all six scenarios. Evidence is recorded in validation.md.

All tasks are complete. Task 3.5 was deferred until merge by repository policy and was closed by the separate post-merge documentation archive; see validation.md for evidence and explicit production/provider gaps.
