# Proposal

## Why

Readers need to change the paper, ink and typography of an article without changing how the rest of Slax Reader looks. The Web and Mobile readers should offer the same choices while keeping their current appearance for people who never open the controls.

## What Changes

- Add a localized **Reading appearance** entry to ordinary HTML article reading on Web (desktop and narrow layouts) and Mobile (iOS and Android). Include saved and shared HTML articles, including the public Web article reader where it renders readable prose.
- Expose separate controls for page background, body text color, text size and typeface. Use named color presets, relative sizes, and device-available default, serif and sans-serif families. Distinguish unavailable low-contrast combinations rather than silently overriding a choice.
- Show changes on the open article, remember choices on the current browser or device, and offer one action to restore this client's original defaults. No account sync is proposed.
- Keep the article readable offline where already supported. Do not change library or menu themes, rewrite saved content, or restyle fixed-layout PDFs, images, or third-party frames. Preserve marks and the passage being read when prose reflows.

## Capabilities

### New Capabilities
- `reader-appearance-preferences`: Controls, rendering, persistence, reset and reading continuity for user-selected HTML article appearance across Web and Mobile.

### Modified Capabilities
None. Existing Mobile rich-content, annotation, restoration, PDF and toolbar requirements continue to apply.

## Impact

Web article hosts, public rendering and reader menus; Mobile reader actions, native article surface, embedded HTML and local preferences; localized labels and reader tests. Update the root design contract during implementation to allow the opt-in reader-only treatment while preserving each platform's default. No new backend endpoint, remote font service, schema migration or Extension change.
