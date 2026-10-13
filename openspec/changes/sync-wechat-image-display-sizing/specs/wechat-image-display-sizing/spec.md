# Spec Delta

## Purpose

Preserve WeChat article image display constraints through collection and loading so icons stay small and ordinary images shrink proportionally.

## ADDED Requirements

### Requirement: Collection preserves intended image dimensions

For WeChat articles, collection SHALL retain author display widths and parent-constrained widths instead of replacing them with bitmap dimensions. Ordinary images with a resolved display width SHALL fit the reader container with automatic height. Tighter maximum widths and unrelated visible formatting SHALL be retained.

#### Scenario: Parent-constrained icon

- **WHEN** a 500 by 571 image has 100% width inside a 14px parent
- **THEN** its collected display width is 14px with automatic height even after the parent's sizing is removed

#### Scenario: Oversized ordinary image

- **WHEN** an ordinary 2490 by 1148 image is collected
- **THEN** it retains its preferred width, fits the available container, and shrinks with its intrinsic aspect ratio

#### Scenario: Author constraints and CSS priority

- **WHEN** an image supplies a pixel, relative, percentage, or HTML attribute width, including important or duplicate CSS declarations
- **THEN** collection honors the effective author size and available parent constraint
- **AND** a tighter maximum width remains effective

### Requirement: Collection retains height-only constraints and intentional frames

Collection SHALL infer a height-only image's pixel width only when its pixel height and aspect ratio are finite and positive. Otherwise it SHALL retain the height constraint with automatic width. Explicit object-fit cover, contain, none, and scale-down frames SHALL retain their display height. Missing size evidence SHALL NOT imply a full-width image.

#### Scenario: Reliable height-only icon

- **WHEN** an image has height 24px and a reliable height-to-width ratio of 2
- **THEN** its display width is 12px, subject to its parent constraint, with automatic height

#### Scenario: Relative height or invalid ratio

- **WHEN** an image supplies only a relative or expression height, or its ratio is absent or invalid
- **THEN** collection preserves the height with automatic width rather than using bitmap width

#### Scenario: Intentional crop

- **WHEN** an image supplies a 24px by 24px object-fit cover frame
- **THEN** collection preserves that frame instead of flattening it into a proportional image

### Requirement: Loading preserves WeChat display constraints

Outside PhotoSwipe presentation, the Web reader SHALL preserve meaningful existing WeChat width, height, max-width, and max-height constraints when small images load. A generic 100% maximum alone SHALL NOT suppress the existing intrinsic-width fallback. Existing behavior for non-WeChat articles, PhotoSwipe, error handling, and tiny tracking images SHALL remain unchanged.

#### Scenario: Small bitmap backs a smaller icon

- **WHEN** a WeChat icon has display width 14px and loads a 96px bitmap
- **THEN** its width remains 14px and its other retained formatting remains effective

#### Scenario: Height-only or maximum-only constraint

- **WHEN** a small WeChat image has a meaningful height or maximum-size constraint
- **THEN** loading does not replace its style with its bitmap width

#### Scenario: No meaningful display size

- **WHEN** a 96px WeChat image has only automatic height and optionally max-width 100%
- **THEN** the existing 96px intrinsic-width fallback remains in effect

### Requirement: Historical resizing respects intentional image frames

The existing proportional-resizing fallback for fixed-pixel WeChat images SHALL exclude explicit object-fit cover, contain, none, and scale-down frames. Other eligible oversized images SHALL retain the existing initial correction, resize correction, delayed measurement, and disposal behavior.

#### Scenario: Wide intentional frame

- **WHEN** an 800px by 100px object-fit cover image with max-width 100% appears in a 360px article
- **THEN** the image retains its 100px frame height through processing and loading

#### Scenario: Existing ordinary oversized image

- **WHEN** a saved ordinary fixed-size image exceeds the measurable article width initially or after a resize
- **THEN** the existing proportional correction runs and pending resize work is released on disposal
