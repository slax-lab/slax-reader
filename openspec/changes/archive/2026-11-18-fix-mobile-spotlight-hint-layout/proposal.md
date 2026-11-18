# Proposal

## Why

On iOS versions without Spotlight indexing support, Settings places the system-search title and the iOS 18 requirement message side by side without shrink constraints. Their combined intrinsic width can exceed the card, leaving the requirement message outside its bounds.

## What Changes

- Place the unavailable Spotlight message below its title, within the card's content width, allowing natural wrapping and content-driven height.
- Keep the complete Chinese and English messages readable on narrow screens and with larger system text.
- Preserve the existing capability gates, supported-system switch, persisted preferences, and donation controls.

## Capabilities

### New Capabilities

- `mobile-system-search-settings`: Readable, bounded presentation of the system-search availability message in Mobile Settings.

### Modified Capabilities

None. Existing persistence and publication requirements remain unchanged.

## Impact

- Update Mobile to the human-approved `1.0.32 (807)`, with previous build `806`, and regenerate matching native metadata.
- Presentation changes are limited to `apps/mobile/src/settings/SettingsView.tsx`.
- No native API, dependency, translation, or persistence change is planned.
- Verification covers Chinese and English, narrow iPhone widths, enlarged text, unsupported Spotlight availability, and the supported switch state.

## Non-goals

- Redesigning the Settings screen or changing other settings rows.
- Changing iOS support floors, indexing limits, or system-action behavior.

## Review status

Approved by the requesting human on 2026-11-17 in conversation, including narrow-screen and enlarged-text coverage. This is a local layout correction, not a material UX restructuring.

## Delivery decisions

On 2026-11-17, the requesting human reported hands-on testing and confirmed the result meets expectations. The human explicitly requested opening the PR without screenshots because this is a simple text-layout adaptation, and approved Mobile `1.0.32 (807)`. No screenshot is claimed.
