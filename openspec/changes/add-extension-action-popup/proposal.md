## Why

The toolbar action currently enters the save flow immediately. Users need an explicit save action, a short path to Inbox, and an indication that a save is readable or a subscription has new content.

## What Changes

- Open a browser-native action popup with Save current page, Open Inbox, and up to two clickable account notifications.
- Indicate unread account notifications with a red dot on the toolbar icon alongside the existing saved-page checkmark.
- Reuse the existing save flow, collection unread rule, and PowerSync bridge. Show one notification of each kind when both kinds are available. Clear readable save reminders when the main Inbox is shown.
- Show each reminder on one line with a quoted subject, its full status, and a coral dot at the end of the row.
- Use the Web's warm paper and accent roles in this popup through Extension-owned styles. Keep the existing Extension surfaces and PDF guidance profiles.
- Store save reminder dismissals and the Inbox checkpoint in the current browser. Reuse the existing subscription cursor and upload path. No database migration or new HTTP endpoint is required.

## Capabilities

- add `extension-action-popup`: explicit toolbar actions and derived account notifications.

## Impact

Extension action, save dispatch, session and bridge; Web Inbox and local collection queries; existing API subscriber cursor persistence. Native popup behavior, PDF entry, authentication and live local synchronization require browser verification.

The requester approved the implementation proposal in conversation on 2026-11-26 and chose to review the implemented popup directly.

On 2026-11-27 the requester approved the mixed two-slot selection and the single-line notification format with middle truncation.

On 2026-11-27 the requester reviewed the 320 CSS pixel Chromium design previews for the native rectangular frame, including the plain, grouped, and bordered notification treatments. They approved implementing the divider preview: a standalone terracotta Save button at the top, notification rows on the paper surface with subtle separators, and secondary Inbox navigation at the bottom. The preview covered English and Chinese label space, the default state and an inset notification hover. The requester asked to review the working implementation.

Later on 2026-11-27, the requester reviewed the grouped layout in the native 320 CSS pixel Chromium light popup and approved implementing the refined preview. In response to their feedback, Save stays at the top, the two default and hover-previewed notification rows share one light card, and the Inbox icon, label, and external arrow are centered as a group in the bottom bar. The requester asked to review the implemented layout.

The requester then asked to restore direct sign-in from the toolbar when signed out and use the same sign-in flow for actions from an already-open popup after session expiry or an interactive authorization failure. They also requested an edge-to-edge Inbox control, more space between notification rows, and a visible notification marker.

The requester asked to hide the notification section when it has no rows and keep ordinary page-save feedback in the toolbar popup. Save uses the existing three-dot animation during submission, shows an acknowledged state with a completion icon, and enables the reader action only when the current bookmark is readable.

The requester asked to lighten the popup background to match the Web Inbox in light mode.

The requester asked for a visibly inactive treatment for the saving and saved states. The loading dots match the muted label and sit directly on the paper surface. The saved label and completion icon use the primary action's accent on the same paper surface.

The requester asked for a short fade when saving becomes saved and when saved becomes readable.
