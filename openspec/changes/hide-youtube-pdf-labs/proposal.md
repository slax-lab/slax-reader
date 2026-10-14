# Proposal

## Why

Settings currently advertises YouTube videos and PDF bookmarks as user-selectable Labs features. Temporarily hide those two opt-in controls without changing saved preferences or removing the underlying features, while retaining the remaining Labs controls.

## What Changes

- Exclude the `youtube` and `pdf` rows from Settings Labs for all users, regardless of their enabled or graduated state.
- Keep RSS and other translated, non-hidden Labs rows available with their existing behavior.
- Use the same visibility rule for the Labs card and parent Features navigation/section so a hidden-only response leaves no empty section or inaccessible controls.
- Preserve the complete Labs state, existing preferences, save/upload gates, and access to existing saved content. Merely visiting Settings must not enable or disable a feature.
- Preserve safe Settings navigation, including `/user#labs` when no Labs rows remain.

This is a visibility-only change, not feature graduation. Users who have not already enabled YouTube/PDF remain subject to the existing backend restrictions and lose these Settings opt-in controls. Existing blocked-save copy and links to Settings are unchanged and may no longer lead to the corresponding switch; this consequence is explicit for human review.

## Capabilities

### New Capabilities

- `settings-labs-visibility`: Settings-only visibility of Labs rows and their navigation, independent of feature entitlement and persisted preferences.

### Modified Capabilities

None. Existing living specs do not define Settings Labs visibility. The in-flight `pdf-bookmarks` and `rss-labs` capabilities keep their acquisition and authorization policies; this change does not carry deltas for them.

## Impact

- Web presentation: `apps/web/app/components/UserLabSection.vue` and `apps/web/app/pages/user.vue`.
- A small shared visibility predicate near `apps/web/app/composables/useLabFeatures.ts`, without changing its state or persistence semantics.
- Existing Web component/page tests, with regressions for remaining controls, hidden-only responses, preference preservation, and navigation.
- No API, contract, database, dependency, runtime-token, or Extension changes.
- Isolated branch `fix/hide-youtube-pdf-labs`, based on `origin/dev`; after human review, implementation, validation, and the required local review, submit its own PR targeting `dev` with `OpenSpec: hide-youtube-pdf-labs`.
