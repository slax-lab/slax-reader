# Design

## Context

See [proposal.md](proposal.md) for the source audit. V2's image processor and unit tests match the legacy baseline exactly. The processor already preserves WeChat inline styles, handles image loading and previews, and receives a cleanup list from the article lifecycle.

This affects the Web article renderer under `DESIGN.md`. Responsive dimensions are local to third-party article content; no theme token, global selector, or Extension profile change is needed.

## Goals / Non-Goals

**Goals:** Preserve the source fix's narrow eligibility and lifecycle behavior, with v2 regression coverage.

**Non-Goals:** Change capture output, rewrite image markup, modify PhotoSwipe, or redesign the existing small-image load handler.

## Decisions

- Port the source algorithm after the existing per-image setup. Select images with inline pixel width and height only for the existing WeChat host allowlist, excluding PhotoSwipe. A global height override would discard intentional source sizing.
- Compare declared width with the article container's positive `clientWidth`. Set only width to `100% !important` and height to `auto !important` when the declared width exceeds it. Natural image size is not a sizing signal: a high-resolution asset may intentionally render as a small icon.
- Measure immediately, then use the container document's `ResizeObserver` when available. Waiting only for `load` misses lazy or already-cached images. Register observer disconnection in the existing cleanup list; add no global listeners.
- Keep the source's one-way conversion: once an image becomes responsive, later growth does not restore its former fixed pixel dimensions. Existing load and preview handlers remain authoritative.

## Risks / Trade-offs

- Zero-width initial rendering → defer correction until a positive width is observed; retain initial-only behavior if resize observation is unavailable.
- Nested source layout and existing small-image handlers can affect final dimensions → preserve the source scope and verify relevant existing image tests rather than broadening the port.
- DOM unit tests do not calculate layout → also verify the actual processor with article styles at narrow mobile, the 768px transition, and desktop widths in light, dark, and e-ink.

## Migration Plan

After proposal approval, port the processor and tests, validate, perform the three review passes in `REVIEW.md`, and update this branch's PR targeting `dev`. Existing saved articles are fixed on rendering without data migration. Reverting the processor change restores prior behavior. Archive the OpenSpec change only after merge.
