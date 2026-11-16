# Design

## Context

See [proposal.md](proposal.md) for the pinned legacy sources. V2's Web processor already includes #1616 with deferred resize writes; the API still restores fixed Readability dimensions. The installed Readability 0.6.5 and linkedom match the source fix's expectations.

This is the Web third-party article renderer under root DESIGN.md. Dimensions describe source content, so local inline sizes are appropriate; no tokens, global CSS, or Extension styles change.

## Goals / Non-Goals

**Goals:** Preserve the paired source fixes while retaining v2-specific resize scheduling and lifecycle behavior.

**Non-Goals:** Upgrade Readability, refactor general HTML/CSS parsing, change image previews, or migrate stored bookmarks.

## Decisions

- Preserve case-sensitive CSS custom-property names and the winning declaration order during the port. Local review found that the source helper lowercases custom properties and moves duplicate longhands before intervening shorthands, changing author dimensions and formatting. Regression tests and browser measurements cover both corrections.
- Port the API helper that backs up original styles, resolves duplicate declarations with CSS priority, prepares plain dimensions for Readability, and restores intended dimensions afterward. Replacing extraction or trusting bitmap metadata would discard parent-constrained icon widths.
- Preserve explicit widths, including relative dimensions; use Readability's generated pixel width as a parent constraint for recognized sizes. Derive height-only pixel width only from a finite positive ratio; otherwise preserve the height and automatic width. Avoid guessing widths for unknown expressions.
- Give ordinary images automatic height and a container maximum, preserving tighter author maxima. Retain explicit dimensions for object-fit cover, contain, none, and scale-down frames.
- Port Web display-constraint detection and frame exclusion into the existing processor. Keep v2's ResizeObserver animation-frame deferral and disposal cleanup instead of replacing the entire file.
- Exercise the real Readability pre/extraction/post pipeline in API regression tests, and the real Web processor in unit and browser checks. DOM-only mocks do not verify actual layout.

## Risks / Trade-offs

- Linkedom does not implement browser CSS priority semantics → retain the source helper and regressions for important, duplicate, and uppercase declarations.
- Small intrinsic assets can overwrite retained capture dimensions on load → include natural widths below and above 200px and height-only/maximum-only constraints.
- Existing article sizing and intentional frames can interact → retain legacy oversized-image, resize, and cleanup tests, plus a browser fixture that passes API output to the actual Web processor.
- Synthetic fixtures cannot verify every publisher layout → report their scope and measure icons, ordinary images, and frames at narrow mobile, 768px, and desktop in all three Web themes.

## Migration Plan

After proposal review, port tests and observe the failures, then port implementation and complete validation and REVIEW.md's Bugs/Security/Compliance passes. Create one PR targeting dev. Release Web before API when deploying separately. Revert the paired implementation to roll back; there is no data migration. Archive only after merge.
