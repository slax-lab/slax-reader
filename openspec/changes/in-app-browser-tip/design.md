# Design

## Context

The Web application uses the global `default` layout for user-facing pages, while several page components contain their own fixed or sticky top bars. The existing `TopTips` component is tied to share-page content and has no close control. The change must therefore be global without changing document flow or requiring every fixed header to reserve a new height.

## Goals / Non-Goals

**Goals:**

- Use a conservative, pure user-agent classifier whose default result is hidden.
- Show one client-only floating card across eligible default-layout pages.
- Keep native Slax Reader and standalone PWA contexts excluded.
- Preserve page layout, safe-area spacing, theme coverage, accessibility, and a bounded manual-dismissal cooldown.

**Non-Goals:**

- Do not attempt to force an external browser through `window.open`, `intent://`, or app-specific deep links.
- Do not infer an embedded browser from generic mobile-device detection, referrer, viewport, or touch support.
- Do not change API contracts, server redirects, or protocol-page content.

## Decisions

### Conservative classifier with explicit markers

Add a pure utility that returns a supported embedded-browser kind or `null`. Strong markers include `MicroMessenger`, `Instagram`, Facebook-family markers, an explicit YouTube marker when present, and Android's `; wv` WebView marker. Ordinary browsers and unknown strings return `null`. The classifier also excludes the SlaxReader marker at the caller boundary.

The alternative of treating every mobile browser as embedded would create the exact false-positive failure the feature is intended to avoid. The alternative of relying only on a generic `wv` marker would miss iOS app browsers and cannot identify every YouTube build, so explicit app markers remain preferred.

### Global floating card instead of an in-flow banner

Mount a new `InAppBrowserTip` from `apps/web/app/layouts/default.vue` inside `ClientOnly`. The card is fixed within the WebView viewport, uses safe-area-aware top/side offsets, and does not contribute layout height. It sits above ordinary page chrome but below modal layers. This avoids changing the offsets of `SnapshotTopBar`, `BookmarksTopBar`, guide headers, and other page-specific fixed elements.

The existing `TopTips` component remains scoped to its current share-page behavior. A separate component owns the different semantics, close behavior, and global styling.

### Client-only state and route policy

The component evaluates the current route after mount, excludes protocol and technical routes, and watches route changes because the default layout persists during client navigation. Manual dismissal is stored in a versioned `localStorage` record `{ manualCloseCount, cooldownUntil }`. The first explicit close is recorded and the card appears again on the next eligible visit. The second explicit close starts a one-hour cooldown. Expired or malformed state resets to zero. Storage failures use an in-memory fallback and never break rendering.

### Pointer drag dismissal

The card accepts primary pointer gestures outside interactive controls. Pointer capture keeps the gesture reliable when the pointer leaves the card; only upward movement is followed, while short or downward movement springs back without recording a dismissal. A gesture that moves at least 40% of the card height upward is committed as a manual close and animates beyond the top edge. Pointer cancellation and lost capture always clean up without counting. Reduced-motion and e-ink modes do not wait on a nonessential animation to finish.

### Semantic Web styling

The card uses existing `--slax-surface-solid`, `--slax-text`, `--slax-text-muted`, `--slax-border`, `--slax-accent`, `--slax-shadow-sm`, radius, font-size, and duration tokens. E-ink mode inherits the existing no-shadow/no-blur token values. The close control has a visible focus ring and a touch target larger than its icon.

The instruction renders the registered `snapshot.more` menu icon inline, rotated to the horizontal three-dot convention used by WeChat and Instagram, instead of using an ellipsis glyph. The visual card uses a softened accent rail inset from the edge, a subtle accent-tinted boundary, and an inset highlight so the emphasis remains legible without reading as a hard border. Screen readers receive a localized text equivalent for the icon-led instruction.

## Risks / Trade-offs

- **[Risk] Third-party apps change their user-agent strings.** → Keep the classifier pure, add representative fixtures, document that unknown values remain hidden, and expand only from observed real-device samples.
- **[Risk] Android WebView detection can include embedded contexts outside the named apps.** → Require both Android and the `; wv` marker; never use generic mobile detection.
- **[Risk] The card can cover page content near the viewport top.** → Keep it compact, place it below the safe-area inset with bounded width, and keep modal layers above it.
- **[Risk] Local storage is unavailable in privacy-restricted WebViews.** → Catch access errors, retain a small in-memory state for the current runtime, and keep the card usable without blocking the page.
- **[Risk] A drag can be mistaken for a close-button activation.** → Ignore pointer starts from interactive descendants and share one guarded manual-close commit path for button and drag dismissal.
