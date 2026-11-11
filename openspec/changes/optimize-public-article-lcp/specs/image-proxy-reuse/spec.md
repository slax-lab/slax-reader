# Spec Delta

## Purpose

Keep signed image resources usable when capture or Web presentation encounters an image URL already served by the configured first-party image proxy, without changing saved reading anchors or media access checks.

## ADDED Requirements

### Requirement: Existing configured image proxy URLs are reused

Generating an image proxy URL for an already proxied source with the same configured origin, path and requested signing mode SHALL NOT introduce another proxy wrapper. Its existing signed URL SHALL be preserved byte-for-byte when reusable. Ordinary source URLs SHALL retain the existing signing, mode and public-target behavior. Recognition SHALL NOT treat lookalike origins or unrelated paths as the configured proxy.

#### Scenario: Capture processes an already proxied image twice
- **WHEN** a reusable signed image source passes through capture image processing again
- **THEN** the resulting URL is identical to that source and does not add another proxy request hop

#### Scenario: Signing mode differs
- **WHEN** processing requests RSS image mode for a source signed under the ordinary image mode
- **THEN** the result retains RSS-mode validation and cannot silently reuse the ordinary-mode URL as RSS-authorized media

#### Scenario: Source is a lookalike proxy
- **WHEN** a source uses a different origin or path resembling the configured image proxy
- **THEN** processing applies the ordinary source rules rather than accepting it as an existing first-party proxy result

### Requirement: Known nested sources recover without rewriting saved bodies

The Web projection SHALL recover the observed one-extra-wrapper image source by selecting its complete inner signed URL only when both layers match the configured proxy, signing mode and supported shape. The selected URL SHALL still pass the image endpoint's existing signature, Referer and public-target checks. Canonical stored HTML, text, element order, identifiers, selection anchors and PR #449 loading-policy behavior SHALL remain unchanged. Unsupported shapes SHALL retain existing behavior rather than guessing a destination.

#### Scenario: Saved image has the observed nested proxy shape
- **WHEN** an authorized Web article response contains an outer configured proxy wrapping a complete signed inner configured proxy URL
- **THEN** the rendered image source uses the complete inner URL with its signed query bytes intact
- **AND** the image renders when that inner URL is valid for the Reader request

#### Scenario: Nested source is malformed or foreign
- **WHEN** the wrapped value is malformed, lacks required signed fields, uses another origin/path or exceeds the supported shape
- **THEN** the projection leaves its source unchanged and grants no new media access

#### Scenario: Body is refreshed repeatedly
- **WHEN** a repaired article is hydrated, refreshed or processed again
- **THEN** its image source remains stable without another wrapper or a policy-driven source switch
