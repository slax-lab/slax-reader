# Proposal

## Why

Web mixes URL saving and PDF selection in one form, while Mobile opens separate dialogs for URL, PDF, and RSS acquisition. Users need one predictable add surface with explicit acquisition modes and a non-blocking hint when a pasted URL resembles a feed.

## What Changes

- Add built-in URL, Feed, and File tabs to the existing Web and Mobile acquisition surfaces, preserving each application's existing dialog layout, tokens, typography, spacing, and controls. Do not build a standalone imitation app or replace Mobile's centered Add URL dialog with a new bottom-sheet design.
- Show Feed and perform local URL candidate detection only after the current account's RSS Labs state confirms enablement. Preserve PDF Labs gating for File.
- Offer an inline possible-feed hint with explicit switch and dismiss actions; never auto-switch, subscribe, or fetch a pasted address.
- Carry the address between URL and Feed, retain per-mode drafts during the open session, and preserve the existing URL-save, feed-subscription, and single-PDF-upload behavior.
- Route RSS add entry points into the unified surface with Feed selected, while keeping existing rename/edit flows separate.
- Prepare the review demo by changing these real components in the isolated worktree, not by introducing a duplicate mock UI.

## Capabilities

### New Capabilities

- `content-addition`: Unified acquisition tabs, draft behavior, explicit RSS candidate hints, and application-native presentation.

### Modified Capabilities

- `rss-labs`: The native RSS add entry opens Feed in the unified add dialog instead of a dedicated bottom form; all other subscription and reader behavior remains unchanged.

## Impact

- Web: `AddUrlTopModal.vue`, `BookmarksPage.vue`, `RssPanel.vue`, existing RSS/Labs composables, translations, and associated component/integration tests.
- Mobile: the real add-dialog composition in `LibraryScreen.tsx`, `LinkInputDialog.tsx`, `PdfImportDialog.tsx`, `RssFeed.tsx`, feature controllers, translations, and existing mounted-host tests. Title editing must remain unchanged.
- A small platform-neutral candidate policy may be shared through an already-consumed package; no new runtime dependency is required.
- No backend endpoint, database migration, new file format, automatic website-feed discovery, or acquisition authorization change.

## Demo and Approval Boundary

The change requester requested a real-component Web and App demo in the isolated `feat/add-content-tabs` worktree, based on `origin/dev` at `2203281e`, and rejected a standalone mock implementation.

On 2026-11-17, the change requester (the repository owner and GitHub user behind this checkout) reviewed the implemented Web dialog's Link, Subscription, and File screenshots and native Android Subscription screenshots with and without the keyboard. The requester stated in conversation that UI and frontend review were complete with no problems and asked to open the PR. This records acceptance of the shown implementation after the adjustments below, not unobserved interactions or full feature verification.

The demonstrated scope was the real `AddUrlTopModal.vue` mounted with Labs toggles in the gitignored `.local/demo` page at `http://localhost:5799`, in Chinese/light theme at approximately 1200px viewport width, and the Android development app `com.slax.reader` on a Pixel 9 Pro Fold via ADB. The Web demo was not the logged-in `/bookmarks` route. Android showed the Subscription dialog translated upward by 384px with the keyboard, retaining its 1022 × 828px size and visible inputs/action. No server-side URL save, subscription, or PDF upload was submitted, and no iOS device run occurred.

Review feedback incorporated before acceptance:

- Use Chinese tab labels `链接` / `订阅` / `文件` (Link / Subscription / File), and `RSS 地址` (RSS address) as the Feed placeholder.
- Remove the “Import PDF file” entry from URL; PDF entry belongs only to File.
- Restore Mobile's pre-change title weight, 50-point input height, 8-point radius, 12-point horizontal padding, and default green full-width action. Use text-only tabs following the LoginScreen agreement-tab style rather than an independently redesigned dialog.
- Keep Android inputs and the action reachable by moving the dialog upward without resizing it.

This is the actual implemented-demo feedback and acceptance record. It does not retroactively claim a separate pre-implementation requirements-discovery approval under `DESIGN.md` §10.1, or approval of its entire state/theme/width matrix. The accepted feedback is the requirements target for the shown surfaces; the existing delta-spec obligations are not reduced. Web desktop/768px/320px matrix coverage, dark/e-ink, English, browser keyboard/focus behavior, additional native states, live acquisition calls, and iOS device verification remain unverified as detailed in `validation.md`. The requester reviewed screenshots; no claim is made that they personally operated those flows.

Subsequent review fixes changed RSS entry routing and in-dialog Feed busy/error behavior. On 2026-11-17, the change requester explicitly confirmed hands-on acceptance of the UI including those post-review changes: Mobile Feed busy/error feedback remains in the dialog, RSS Add entries open the unified dialog on Feed, and Web Feed uses the existing RSS owner. They stated that they looked at it and the UI had no problems. This supersedes the pending renewed-acceptance record under `DESIGN.md` §10.2. It is requester-supplied acceptance, not an additional agent-run browser/device exercise or proof of the full runtime matrix.

The earlier Android keyboard measurements remain pre-fix evidence, not a post-fix rerun. Post-fix agent verification confirmed only that Inbox `+` opens the expected empty Link dialog (`/tmp/slax-verify-url.png`); further tab verification stopped because the pre-existing approximately 350ms autofocus raises the keyboard, contrary to the user's testing constraint, and hiding it with a key event dismisses the dialog. The RSS rail Add entry was not visible on this account.

The routing, gating, Feed submission, and draft fixes have the automated evidence recorded in `validation.md`. The subsequent 2026-11-17 Mobile File-session implementation removes the standalone `PdfImportDialog` handoff: `LinkInputDialog` now retains the PDF draft across tabs and picker cancellation. Mounted-host checks pass; new native picker/modal behavior and live upload remain unverified. This does not expand the earlier human acceptance record.

On 2026-11-17 the requester also explicitly approved Mobile **1.0.31 → 1.0.32**, **buildNumber 806 → 807**, and **previousBuildNumber 805 → 806**. The manifest and tracked native main/share/runtime metadata were updated through existing Expo tooling as detailed in `validation.md`. The requester confirms the prescribed local pre-push review was run and its reported findings were fixed afterwards; separate implementation/runtime gaps remain open. No commit, push, PR creation, release, signing, or upload occurred. The latest instruction expressly forbids commit, push, or opening a PR during this follow-up.
