# Proposal

## Why

The public `/b/[id]` reader currently presents saving as a bordered `Fork` button. The supplied [product reference](https://claude.ai/artifact/RCqquktdZzjguYRoZ9uQtq) presents this more clearly as a quiet star-and-label action; the reader should adopt that presentation within the Web design contract.

## What Changes

- Restyle the existing top-right action as a transparent, borderless inline star and label, with theme-aware hover, active, focus, loading, unavailable, and saved states.
- Use `收藏本篇` / `已收藏` in Chinese and `Save for later` / `Saved` in English. Use `收藏中…` / `Saving…` during a request and consistent save terminology in the action's offline/failure feedback.
- Show an outline star before saving and a filled star after admission or persisted pending/success status. Omit the reference's trailing checkmark in both locales.
- Render curated SVG through `AppIcon` and the Web runtime registry, reusing existing star geometry. Record semantic keys, size, paint, accessibility, and provenance; document the save-state icon contract in root `DESIGN.md` and index its usage in `docs/design/README.md`.
- Preserve the existing admission, login, duplicate prevention, retry, owner visibility, and account/source isolation behavior. An already saved action remains disabled and stays on the source page.

## Capabilities

### New Capabilities

- `snapshot-save-presentation`: Localized public-reader save-action presentation, visual state mapping, and theme/accessibility behavior.

### Modified Capabilities

None. The existing `runtime-icon-registry` contract is consumed unchanged. Fork admission and persistence remain governed by `add-bookmark-fork`, whose implementation merged in PR #354 on 2026-10-26; this change introduces no parallel `bookmark-fork` delta and does not perform that change's archival.

## Impact

- Web: `SnapshotForkButton.vue`, its Chinese/English locale entries, the icon manifest and generated registry, page-scoped compact header spacing in `/b/[id]`, and the existing Fork component/composable test coverage.
- Design documentation: `DESIGN.md` and `docs/design/README.md`. The frozen design reference and its manifest remain unchanged.
- No API, schema, shared-package, dependency, Extension, CLI, or Mobile change. No package-version decision is required for this Web-only change.
- Verify the implemented control in light, dark, and e-ink at desktop, the 768px transition, and 320px width, with Chinese/English and keyboard interaction. Record human hands-on acceptance before opening the pull request.

## Review Scope

This is a local presentation adjustment within the existing action and placement, exempt from the optional material-UX demo offer under `DESIGN.md` §10.1. The supplied reference is the visual input.

The requesting project owner approved this proposal on 2026-10-27 (Asia/Shanghai), including the localized labels, outline/filled SVG stars, removal of the trailing checkmark, and preservation of the existing saved-state behavior. The owner requested implementation directly on the current primary-workspace branch. After local hands-on testing, the owner confirmed that the implementation worked without issues and supplied unsaved/saved screenshots on the same date, authorizing PR creation with those attachments. See `validation.md` for the acceptance record and verification limits.
