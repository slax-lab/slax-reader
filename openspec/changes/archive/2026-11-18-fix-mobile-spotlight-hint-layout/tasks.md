# Tasks

## 1. Approval and layout correction

- [x] 1.1 Record human approval of the proposal before implementation and prepare `fix/fix-mobile-spotlight-hint-layout` from `origin/dev`, keeping unrelated local changes intact; verify the branch base and scoped diff.
- [x] 1.2 Move the unsupported Spotlight requirement message below the title in `SettingsView.tsx`, using the card's content width and natural wrapping without a line limit or fixed text height; verify the unsupported state renders the full localized message and the supported state retains its existing switch and callbacks.

## 2. Verification and delivery

- [x] 2.1 Record the requesting human's 2026-11-17 hands-on acceptance and explicit decision to omit screenshots for this simple text-layout change; retain the unverified per-device, locale, width, font-size and appearance matrix as agent verification gaps in `validation.md`.
- [x] 2.2 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; record command outcomes in `validation.md`.
- [x] 2.3 Apply the human-approved Mobile `1.0.32 (807)`, previous build `806`, and regenerate/verify matching native metadata; record hands-on acceptance before opening the PR, complete the three-pass local review from `REVIEW.md`, and resolve Important findings.

## Planning note

The optional `design.md` is omitted because this single-view layout fix introduces no architectural pattern, dependency, data change, migration, or unresolved technical ambiguity.
