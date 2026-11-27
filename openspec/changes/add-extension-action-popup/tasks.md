## 1. Implementation

- [x] Add the browser action popup and delegate save and Inbox navigation to existing entry points.
- [x] Reuse the local bookmark and subscription data through the existing bridge.
- [x] Persist the browser-local Inbox checkpoint and save dismissals, and route notification clicks.
- [x] Preserve subscription unread cursor progress through the existing sync write.
- [x] Add and verify the toolbar unread dot on the shared notification result.
- [x] Use mixed notification selection and verify the single-line quoted subjects and trailing dots.
- [x] Apply the compact menu styling and verify its divider, row highlights and notification copy in Chromium.
- [x] Verify the side-by-side toolbar actions, complete localized labels, and inset hover styling in Chromium, and capture both preview states.
- [x] Apply the approved divider layout and verify native Chromium default, notification hover, localized copy, and navigation.
- [x] Implement the approved notification card and centered Inbox footer, then verify the native Chromium popup and refresh its preview.
- [x] Restore direct and interactive sign-in for the toolbar popup, and verify full-width Inbox hover, separated notifications, and the notification marker.
- [x] Align the notification heading, match divider spacing to the card padding, and capture the native popup after a save becomes readable.
- [x] Group the bell and label above the notification card and verify the section hierarchy and vertical spacing in Chromium.
- [x] Hide empty notifications and implement the saving, acknowledged, and reader button states for toolbar webpage saves.
- [x] Verify the save sequence, reopening before processing, and reader navigation in Chromium, and update the preview.
- [x] Match the Web Inbox light background, preserve notification grouping, and verify the palette in Chromium.
- [x] Give the saving and saved states a non-interactive appearance and verify all four save states in Chromium.
- [x] Match the loading dots to the saving label, apply the primary accent to the saved label and icon, and refresh the Chromium preview.
- [x] Fade the two forward save transitions, verify reduced motion, and refresh the interactive Chromium preview.

## 2. Verification

- [x] Verify behavior and focus states in a running browser, run relevant automated checks, and record evidence.
- [x] Complete scope and edge-case reviews.
- [x] Record human hands-on acceptance before opening a pull request.
