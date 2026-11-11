# Proposal

## Why

Mobile Feedback needs clearer submission placement, consent ordering, and keyboard dismissal. The Reader's More panel also places its Pro badge off-center; this change groups the owner's requested Mobile UI corrections on one branch.

## What Changes

- Replace the header keyboard-dismiss action with localized Submit. Preserve current validation: `content.trim().length > 0`; disable submission while pending or after account/environment ownership changes.
- Remove the redundant footer submit/cancel row and inline keyboard-dismiss action. Native Back remains the exit/cancellation path.
- Show follow-up first, using `Allow follow-up at {email}` in English and `允许通过 {email} 进行跟进` in Chinese. Substitute the signed-in user's email without surrounding brackets, per the owner's copy refinement.
- Show diagnostic attachment second, with Chinese copy `附带最近七天的诊断日志，仅用于定位问题` and equivalent English copy. Keep that visible wording unchanged when toggled, without expanding extra explanatory text; retain the existing accessibility hint. Use 12-point circular checkbox artwork, slightly smaller than the 14-point option labels, while preserving the 48-point minimum row touch target. Keep follow-up enabled and diagnostic attachment unchecked by default.
- Dismiss the keyboard on form-background/context taps and Submit. Consent-row taps toggle once while preserving the current input focus and keyboard state, so the user can continue typing without refocusing. Preserve text selection, multiline editing, drag dismissal, and the draft.
- Keep contextual article information, the Mobile visual profile, and submission result behavior. Make the editor fill the space between the header/context and bottom consent rows. With no keyboard the rows sit at the bottom safe area; when the keyboard opens they move above it and the editor shrinks. Long drafts scroll inside the input without pushing the rows away; dismissing the keyboard restores the available editor height.
- Confirm that Reader More-panel icon tiles remain 56 by 56 logical points. The complete action also includes an 8-point gap and its label (16.5-point base line height), so its base single-line height is approximately 80.5 points, not 56.
- Set every action icon inside those tiles to 24 by 24 logical points, reduced from the existing 28 by 28 points at the owner's request.
- Align the existing Pro badge with the tile's top edge and horizontal center. Preserve its existing 24-point visible width and original 100:40 aspect ratio, removing the square-image letterboxing. Preserve menu actions, labels, item sizing, and spacing.
- Keep Reader text selection light green: the owner confirmed RGBA `#8AD8A866` (40% opacity), then explicitly accepted the iOS native selection highlight's system-controlled opacity. HTML and PDF use that CSS selection color and its matching opaque caret color. Explicitly set the iOS Reader WKWebView's native tint to the same green after the owner reported that CSS-only styling still left the native selection blue.
- Draw each visible comment-quote underline below its measured text line instead of through the font baseline, using the same `#F6AF69` mark-stroke color as the article. Preserve dashed comment-only and solid highlighted states, the two-line ellipsis, original text/copy behavior, font scaling, and comment actions.
- Make the inline Overview excerpt prefix use the same 14-point base typography as its summary content, instead of inheriting the SourceText component's 16-point default.

## Capabilities

### New Capabilities

- `mobile-feedback-presentation`: Header submission, localized consent order/copy, outside-tap keyboard dismissal, and a flexible editor above bottom-anchored consent rows.
- `mobile-reader-toolbar-presentation`: Reader More-panel tile dimensions and Pro badge alignment.
- `mobile-reader-annotation-presentation`: Selection hue and comment-quote underline clearance.
- `mobile-reader-overview-presentation`: Matching prefix and content typography in the inline Overview excerpt.

### Modified Capabilities

None. This is a deliberate user-requested presentation follow-up to the implemented `mobile-diagnostic-log` work. Its older compact-feedback requirement for a fixed compact editor and separate dismiss/cancel controls is superseded on this screen by an editor bounded by available space, header Submit, native Back, and outside-tap dismissal. Attachment consent, export, transport, retention, and account-safety requirements remain in their existing capability; this change carries no competing diagnostic-log or mobile-parity delta.

## Impact

- `apps/mobile/src/screens/FeedbackScreen.tsx`: Header action, consent layout, and keyboard interactions.
- `apps/mobile/src/i18n/appMessages.ts`: English and Chinese option copy; preserve the pinned source catalog in `messages.ts`.
- Existing mounted Feedback tests: Render the navigation header and verify actual header submission and dismissal behavior.
- `apps/mobile/src/reader/ReaderOverlays.tsx`: Action icon sizing and Pro badge layout; use existing Reader menu regression coverage.
- `apps/mobile/src/reader/document.ts`, `pdf-document.ts`, and `components/CommentPanel.tsx`: Mobile-owned selection styling and measured quote decoration, with focused document and mounted comment regression coverage.
- `apps/mobile/modules/slax-platform/ios/SlaxReaderView.swift`: Explicit Reader-local WKWebView tint; this change requires rebuilding the iOS binary.
- `apps/mobile/src/reader/OverviewViews.tsx`: Inline excerpt prefix typography.
- No API, dependency, or shared-package changes are planned.
- Work happens in the main checkout on `fix/mobile-ui-polish`, based on `origin/dev`; pre-existing local configuration/native/deployment edits are preserved.
- After implementation, record native verification and human hands-on acceptance before opening a PR, and obtain the Mobile version decision before commit/push/handoff. Archive through a separate docs PR after merge.

## Implementation approval

On 2026-10-30, the repository owner approved starting implementation of this proposal and requested to run the simulator personally after the edits. Native interaction/visual acceptance remains pending that exercise; this instruction authorizes implementation, not a claim of completed acceptance.

On the same date, the owner expanded the task to Mobile UI polishing, explicitly requested the Reader More-panel Pro badge to align at the item's top and horizontal center, and requested a broader branch name. The branch and change were renamed to `fix/mobile-ui-polish` / `mobile-ui-polish`; the requested local alignment correction is included in the authorized scope. The owner's decision to retain version 1.0.25 (796) remains in effect.

After reviewing Feedback, the owner reported general satisfaction and requested two refinements: attachment consent must not expand additional visible copy when selected, and both circular checkbox icons must be slightly smaller than their text. This feedback supersedes the earlier conditional visible disclosure design and authorizes these local changes. Final acceptance of the refinements and Reader badge remains pending.

The owner subsequently requested an available-height editor with bottom-anchored consent rows that rise above the keyboard while the input shrinks. This explicit layout direction supersedes the earlier fixed compact-editor sizing. The prior choice to implement directly and let the owner exercise the simulator remains in effect.

The owner then requested checking the action icons inside the Reader More-panel tiles and reducing them to 24 points if necessary. The existing action icons were 28 points; this request authorizes the shared rendering size change to 24 points while keeping the tile, label, and Pro badge geometry.

The owner also requested a light-green text selection and moving comment-quote decoration below the glyphs. They clarified that the requested color is RGBA `#8AD8A866`, then chose to retain native iOS selection with its system-controlled opacity after the platform limitation was explained. These choices authorize the scoped document and quote-presentation changes; custom selection tracking is out of scope.

The owner subsequently requested keeping the Feedback input active and the keyboard visible when toggling the bottom options. This explicitly supersedes the earlier consent-row dismissal behavior. Background/context taps and Submit still dismiss; consent taps preserve the existing keyboard state without forcing focus when it is closed.

The owner also requested removing the brackets around the email in the first Feedback option. Both localized visible labels and accessibility labels use the email without brackets.

The owner subsequently reported that iOS selection was still blue and requested two Reader refinements: the inline Overview prefix must match its summary's font size, and comment-popup quote lines must match article annotation lines. This authorizes the native Reader tint correction and both style fixes. Native opacity remains system-controlled by the earlier decision; no custom selection renderer is introduced.

## Hands-on acceptance

On 2026-10-30, after reviewing the latest changes in the simulator, the repository owner reported no substantial remaining issues and explicitly authorized a short review followed by PR creation. This supersedes the historical pending-acceptance notes above. The accepted scope, additional agent exercise, remaining verification/media gaps, and pre-push review are recorded in `validation.md`. Mobile remains 1.0.25 (796), as previously requested.
