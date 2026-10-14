# Mobile Visual Parity Spec Delta

## Purpose

Establish verified one-to-one reproduction of the current mobile UI on both platforms, with a narrowly defined exception for the requested native back control.

## ADDED Requirements

### Requirement: Mobile has its own source-based design profile

The repository design contract SHALL define a Mobile profile preserving the current mobile palette, typography, density, assets, layout, system bars, safe areas, and motion. Mobile runtime values SHALL remain application-owned and SHALL not inherit Web or Extension theme values by default. Native back appearance SHALL be the explicitly permitted platform-specific difference.

#### Scenario: A source mobile component is migrated
- **WHEN** its colors, text metrics, spacing, or artwork differ from Web defaults
- **THEN** mobile reproduces the source mobile values
- **AND** the surrounding layout is not redesigned under the native-back exception

### Requirement: Visual parity covers every source screen and state

Acceptance SHALL compare the source and migrated application on matched Android and iOS device models, OS versions, locale, appearance, font scale, data, safe areas, and interaction state. Baselines SHALL include populated, empty, loading, error, disabled, keyboard, overlay, selection, scrolling, and applicable subscription/permission states. Route existence, screenshots from a Web browser, and source style values alone MUST NOT establish native visual parity.

#### Scenario: Screenshot comparisons are reviewed
- **WHEN** the migration claims one-to-one UI reproduction
- **THEN** native source and migrated renders are compared for every recorded required state
- **AND** text wrapping, positioning, touch targets, assets, and scroll/keyboard behavior are reviewed

### Requirement: Visual exceptions are specific and reviewable

Visual differences SHALL be resolved or explicitly accepted by the user. Comparison exclusions SHALL be limited to unavoidable dynamic system content and the agreed native-back region; entire headers, missing controls, or unsupported screens MUST NOT be masked. Unknown or unavailable platform renders SHALL remain incomplete evidence.

#### Scenario: Native back artwork differs from the source icon
- **WHEN** the platform renders its native back control
- **THEN** the control's documented region is the allowed difference
- **AND** adjacent article title, tools, safe-area positioning, and content remain subject to comparison

### Requirement: Asset and accessibility fidelity are preserved

Copied assets SHALL retain source provenance, logical size, original brand paint, licensing notices, and deterministic transformations. Both languages SHALL preserve labels and text expansion. Controls SHALL retain accessible names, touch targets, focus/selection behavior, and platform accessibility scaling without confusing duplicated labels.

#### Scenario: A source vector requires conversion
- **WHEN** an original mobile vector cannot be consumed directly by the chosen runtime
- **THEN** its geometry is preserved through a deterministic application-owned transformation or approved renderer
- **AND** it is not replaced with an approximate icon from an unapproved library
