# Design

## Context

See `proposal.md` for motivation and the deliberate distinction between hiding controls and changing entitlement.

`UserLabSection.vue` displays every feature with a translated name and starts the shared Labs fetch when mounted. `pages/user.vue` independently uses the same translation condition to decide whether to show the Features navigation item and section. `useLabFeatures.ts` stores the complete API response; consumers outside Settings use it for YouTube save gating and PDF upload availability. Removing entries from that shared response would therefore disable features unintentionally.

This affects the Web profile under `DESIGN.md`. No visual tokens, typography, component dimensions, or Extension presentation need to change. A design artifact is included because two presentation layers must agree without changing shared authorization state.

## Goals / Non-Goals

**Goals:**

- Express the Settings-only exclusion once and reuse it for both the card and navigation.
- Keep the existing fetch lifecycle and all non-Settings consumers unchanged.
- Make reversal a small presentation change with no preference migration.

**Non-Goals:**

- Retiring or graduating PDF/YouTube, changing server feature definitions, or automatically opting users in.
- Removing translations, saved content, PDF upload functionality, or Labs error handling.
- Implementing the separate `extension-pdf-save` change, replacing the Labs architecture, or changing themes.

## Decisions

### Use a shared presentation predicate, not filtered shared state

Export a narrowly named Settings visibility predicate alongside `useLabFeatures.ts` and combine it with the existing translation check in `UserLabSection.vue` and `pages/user.vue`. Exclude exactly `youtube` and `pdf`; do not replace the list with an RSS allowlist, which would hide future translated features.

Filtering `fetch()` results is rejected because `isEnabled()` and non-Settings consumers must still see hidden enabled features. Deleting localization keys is rejected because those keys also supply save-error text and would encode product policy in translation completeness. CSS-only hiding is rejected because it can leave controls or empty sections in navigation and accessibility behavior.

### Preserve mounting and derive parent visibility from the same eligible rows

Keep the parent Features section's `v-show` lifecycle while updating `hasLabs` to the shared predicate. Changing it to `v-if` would prevent the child from mounting when the initial list is empty; the child's `onMounted` fetch could then never run. The card continues to omit itself when its filtered rows are empty.

Existing section navigation already tolerates a missing `#labs` target. Cover both hidden-only and asynchronously populated responses instead of introducing a new redirect or replacement Settings section. Keyboard navigation must not reach removed rows or an absent Features destination.

### Keep acquisition policy outside visibility

Neither the backend Labs definition nor Web client gates change. Existing enabled users retain functionality; disabled users retain restrictions. Existing blocked-save messages/actions can still link to `/user#labs` without revealing the hidden switches. This is an explicit temporary limitation, not a claim that the opt-in journey remains available. If human review requests broad availability or different blocked-save feedback, revise the proposal before implementation rather than bypassing the gate in the Extension task.

## Risks / Trade-offs

- [Two predicates drift] → Share the exclusion helper and test both the row list and parent navigation with identical mixed and hidden-only inputs.
- [Visibility filtering mutates preferences] → Assert the complete feature data and `enabled_at` values survive rendering and no hidden-feature settings POST occurs.
- [Initial empty state prevents loading] → Preserve child mounting and test delayed Labs responses.
- [Disabled users are directed to hidden controls] → Make the limitation explicit in review and keep any acquisition-policy change separate; do not silently auto-enable features.
- [Tests previously exercised YouTube as the visible example] → Move remaining-control behavior tests to RSS while adding dedicated hidden-key assertions, preserving gate tests unchanged.

## Validation

Extend `apps/web/tests/unit/components/UserLabSection.spec.ts` for mixed rows, hidden enabled/disabled/graduated states, hidden-only and untranslated-only responses, unchanged data, and RSS success/failure. Update `tests/unit/pages/user.spec.ts` to use RSS for Features ordering and `#labs` navigation, and verify the hidden-only parent state. Retain the existing `useLabFeatures.spec.ts` and `BookmarkList/AddUrlTopModal.spec.ts` gate/upload regressions.

After worktree-local dependency installation and standard configuration preparation, run:

```sh
pnpm --filter @apps/slax-reader-dweb type
pnpm --filter @slax-reader/selection typecheck
pnpm web -- typecheck
pnpm web -- test tests/unit/components/UserLabSection.spec.ts tests/unit/pages/user.spec.ts tests/unit/composables/useLabFeatures.spec.ts tests/unit/components/BookmarkList/AddUrlTopModal.spec.ts
pnpm web -- test
pnpm web -- build
pnpm exec openspec validate --all --strict
```

Use the actual rendered Settings page to verify keyboard focus, section scrolling, remaining RSS toggles, and no preference writes for hidden features. Cover English and Chinese, light/dark/e-ink, desktop, the 768px transition, and a narrow supported viewport. Happy-dom tests alone do not prove real focus or layout. Missing configuration or integration evidence must be reported, not bypassed by copying secret files or claiming fixture-only checks are end-to-end verification.

## Migration Plan

There is no data migration. After human proposal review, implement on `fix/hide-youtube-pdf-labs`, complete validation, run the Bugs/Security/Compliance pre-push review in `REVIEW.md`, resolve Important findings, and create the requested PR against `dev` with its OpenSpec line. Keep the root mobile checkout and the PDF Extension worktree untouched. Rollback restores the presentation predicate and matching tests; persisted feature preferences remain available. Archive only after merge through the normal workflow.
