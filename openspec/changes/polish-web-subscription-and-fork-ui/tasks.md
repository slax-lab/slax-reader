# Tasks

## 1. Web inbox and subscriptions

- [x] 1.1 Give subscribed avatars a 6px colored unread dot and verify the indicator size and placement for read, unread, and selected avatars in the running inbox.
- [x] 1.2 Align the existing personal list-mode controls with the avatar row and adjust timestamp spacing in the subscribed inbox. Exercise switching between a subscription and My Inbox, switching list modes, clearing a source filter, and loading the inbox with zero subscriptions.
- [x] 1.3 Set the collection feed metadata dividers to 12px and render them only between present fields. Verify entries with complete and partial metadata in the virtualized and fallback markup.

## 2. Fork attribution

- [x] 2.1 Add the Fork-only horizontal metadata layout and localized attribution. Update the attribution tests for authorized links, hidden identities, unavailable snapshots, and neutral metadata.
- [x] 2.2 Exercise public and private article headers, including ordinary articles, Forked articles, newsletter sources, and URL-backed or uploaded PDFs. Check the source link behavior, permission-sensitive states, keyboard focus, and long-name truncation at 320px, around 768px, and on desktop in light, dark, and e-ink modes.

## 3. Verification

- [x] 3.1 Run the relevant Web checks and `openspec validate --all --strict`. Record running-environment evidence for the list, detail, and Feed changes in `validation.md`.
- [x] 3.2 Prepare the running environment for human hands-on acceptance, incorporate feedback, and record acceptance before opening the task pull request.

## 4. Web Feed follow-up

- [x] 4.1 Correct Feed source text line heights. Verify descender room and horizontal truncation on narrow and desktop widths.
- [x] 4.2 Animate Newsletter disclosure height and opacity. Verify configured and unconfigured states, keyboard access, persisted state, and e-ink and reduced-motion behavior.
- [x] 4.3 Strip bookmark query parameters on Feed tab selection. Verify unrelated parameters, old Feed URLs, and outgoing navigation to Inbox and other bookmark tabs.
