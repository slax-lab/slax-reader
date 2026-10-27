# Design

## Context

See `proposal.md` for motivation and scope. `SnapshotForkButton.vue` already owns the complete control and delegates state to `useBookmarkFork`. `/b/[id]` gates owner visibility and metadata readiness. The current button has a border, solid background, and a blanket disabled-opacity rule; there is no leading icon.

The reference was inspected in Chinese unsaved/saved and English saved states on 2026-10-27. It uses an outline/filled star, a quiet text action, and accent-colored saved state. Its trailing checkmark is explicitly excluded. Its saved-button navigation is outside this presentation change and conflicts with the existing intentionally disabled state, so the current Reader behavior is retained.

## Goals / Non-Goals

**Goals:** Keep the change within the Web control, its localized feedback, and its icon/design documentation. Make the saved state clear without interpreting disabled as a failure or an unavailable action.

**Non-Goals:** Altering Fork persistence or admission, changing attribution's `Fork:` label, importing the reference's onboarding/navigation flow, migrating the adjacent share menu, or editing the frozen design-system reference.

## Decisions

1. **Keep the existing state owner.** Preserve props, emitted events, `pending || saved || !ready`, and the composable. Use explicit component classes for saved and unavailable states so the saved accent is not reduced by the general disabled-opacity treatment. Avoid a new state machine or toggle semantics such as `aria-pressed`.

2. **Adapt the reference through Web tokens.** Use `--slax-text-muted` for the resting action, `--slax-accent` for hover/saved emphasis, existing surface/accent-background tokens for pointer feedback where needed, `--slax-radius-sm` for the focus/hover shape, `--slax-font-sans`, and `--slax-fs-aux`. Keep a transparent borderless resting surface and the existing 44px minimum height. An initial 14px star and 6px icon/text gap fit the compact reference; these are local measurements, not new global tokens. Prefer no added motion. Copying fixed light-reference colors would fail the dark/e-ink contract.

3. **Reuse trusted SVG geometry with explicit save semantics.** Add `snapshot.save` and `snapshot.saved` entries backed by the existing `bookmark-action-star.svg` and `bookmark-action-star-active.svg` assets. Both use `viewBox="0 0 24 24"`, 14px defaults, `currentColor`, and `control-labelled` accessibility; the filled variant retains its current-color fill. Preserve the reused geometry's existing registry provenance and manifest source commit. Render through `AppIcon`; regenerate with `pnpm icons:write`. Do not paste unvalidated reference SVG, introduce a Unicode star, or hand-edit generated output.

4. **Document the semantic mapping in the authoritative place.** Add a narrow save-state mapping under root `DESIGN.md` §7 and an index entry in `docs/design/README.md` pointing to runtime assets/registry and the change. Saving a shared snapshot and starring one's existing bookmark remain distinct actions even though they reuse geometry. Do not modify the historical reference gallery or broaden the registry's global requirements.

5. **Keep localization and layout bounded.** Update only `bookmark_fork.action`, `submitting`, `saved`, and the save-action feedback keys in `zh.json` and `en.json`; preserve attribution keys. The page already hides the wordmark below 380px. Verify the longer English label before deciding whether any additional page-scoped compact spacing is needed; preserve the control order, full label, and 44px hit height. Any necessary adjustment remains scoped to the `/b/[id]` header, without changing shared header defaults.

   Runtime measurement found that the English unsaved action pushed the More control past the viewport at 320px and 381px. For this page's non-owner save header only, use 12px horizontal padding, 8px group gaps, and the icon-only brand button at widths up to 480px. Preserve the brand button's accessible name and 44px hit area. Verify both 480px and 481px as well as the original matrix.

## Risks / Trade-offs

- Saved is a disabled native button → style saved explicitly at full opacity; keep true unavailable and pending states recognizable and preserve native suppression of repeated clicks.
- A star can suggest the library's separate starred flag → retain explicit save labels and semantic icon keys; keep the existing save operation unchanged.
- English text is wider → exercise 320px, 380px/381px, 768px/769px, and desktop with the actual adjacent header controls; do not shorten the required label or hide the action.
- Existing icon metadata is generated → validate curated sources and regenerate once; run registry freshness and safety checks.
- `add-bookmark-fork` is merged but unarchived → retain its admission/state contract and avoid overlapping delta ownership; archive this presentation capability separately after its task PR merges.

## Verification and Delivery

Run existing Fork/component and icon tests, Web lint/typecheck/build, icon/design checks, and strict all-project OpenSpec validation. Exercise real rendered unsaved, request-pending, saved, unready, failure/retry, and keyboard states across the required themes/locales/widths. Use a controlled development fixture for visual states where necessary and label backend/login gaps accurately in `validation.md`. Human hands-on acceptance remains required before a PR opens.

The task branch is `feat/snapshot-save-button`, based on `origin/dev` at `0ba059f55777a0c40f7d998554b9edbbe58da9fa`. No deployment or data migration is needed; reverting this UI change restores the previous presentation without affecting saved copies.
