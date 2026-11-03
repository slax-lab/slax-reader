# Tasks

## 1. Review and baseline

- [x] 1.1 The owner approved the complete proposal on 2026-11-03 and requested implementation in the main checkout; see proposal.md.
- [ ] 1.2 Prepare the existing main-checkout Mobile runtime and capture the current affected surfaces, including the subscription strip's measured height and header icon painted bounds; record actual iOS/Android availability and evidence in `validation.md` without claiming unsupported native reproduction.

## 2. Local presentation corrections

Implementation for 2.1–2.5 is complete. Their remaining native acceptance combinations are explicitly recorded in `validation.md`; these combined implementation/verification items remain unchecked until that coverage is resolved.

- [ ] 2.1 Add More-tile pressed highlighting with existing Mobile tokens; verify press/release/cancel and disabled PDF notes in the running app, retaining the accepted icon/tile/Pro geometry and existing menu checks.
- [ ] 2.2 Make the subscription promotion content-sized with default 36-point painted height and 8-point trailing arrow inset; verify Chinese/English, increased text size, tap target, subscription navigation, and existing visibility rules in the native sidebar.
- [ ] 2.3 Apply weight 500 only to Library list-picker labels; verify all offered choices, selected indicators, dismissal, and an unrelated context menu as a regression check.
- [ ] 2.4 Center avatar-and-label groups in Collection and RSS strips, including the Android outer inset path; verify equal default vertical margins, scaled text, horizontal scrolling, unread dots, no-Collection omission, and Reader-return scroll restoration.
- [ ] 2.5 Match SearchGlyph to the existing add-link artwork's visible stroke/color/center and preserve touch areas; inspect both Library and existing Search placements. Record the related small-icon audit findings and surface additional out-of-scope replacements before implementing them.
- [x] 2.6 Record the reviewed Mobile presentation and article-link-copy exception in `DESIGN.md`; verify it agrees with this proposal and does not change Web or Extension profiles.

## 3. Approved follow-up

- [x] 3.1 Restore the original native article-sharing implementation and tests; remove the task's clipboard action, toast state and localization.
- [x] 3.2 Apply warm Reader selection/stroke colors across HTML, PDF, comment quote and native tint; normalize remaining code greens while preserving alpha and artwork. Keep pinned shared assets and generated outputs unchanged.
- [x] 3.3 Replace SourceSwitch with platform-native Switch and verify existing settings success, failure, disabled and persistence paths.
- [x] 3.4 Center existing Reader and image-action notices and set create-tag input weight to 400; preserve message timing and tag behavior.
- [x] 3.5 Preserve source/avatar mounting through Collection/RSS selection while keeping content replacement, scroll reset and account isolation correct; reproduce the remount in a regression test first.
- [x] 3.6 Start picker animation after native presentation, preserve interruption/reduced-motion behavior, and add the scoped Library entrance transition; verify delayed presentation and rapid reversal.

## 3A. Hands-on acceptance refinements

- [x] 3A.1 Compact the Library picker vertical edge padding to 8 points.
- [x] 3A.2 Autofocus the feedback editor while preserving draft and submit ownership.
- [x] 3A.3 Restore #646B68 search secondary text; move source/nested/suggestion/tag-picker gutters inside pressable cells.
- [x] 3A.4 Keep lower outline corners rounded across the morph and panel crossfade, retaining timing and hit testing.
- [x] 3A.5 Run affected regression suites, full Mobile checks and bundles; record native coverage and gaps.

## 3B. Input and search presentation acceptance

- [x] 3B.1 Match Reader title dialog to Add URL while retaining controlled draft/save behavior.
- [x] 3B.2 Apply 8-point search input radii and #333333/#999999 primary/secondary text roles; retain green Search submit.
- [x] 3B.3 Audit native input sites and set their caret/input-selection colors to #16B998 without changing Reader document selection.
- [x] 3B.4 Run Mobile checks/bundles, verify native presentation and record any gaps.

## 3C. Targeted search acceptance

- [x] 3C.1 Restrict keyword clear to nonempty text and retain independent filters.
- [x] 3C.2 Use Reader-style selected/available tag chips and outlined selected-tag summary.
- [x] 3C.3 Raise supporting search text to Settings' 14/20 scale.
- [x] 3C.4 Verify keyword/filter regressions, Mobile checks/bundles and native appearance; record gaps.

## 3D. Source-strip sizing acceptance

- [x] 3D.1 Apply 32-point avatar artwork, 10/14 labels, 4-point label gaps and 22-point item-layout gaps in Collection/RSS; preserve selection clearance and vertical centering.
- [x] 3D.2 Verify checks, bundle and available native rendering.
- [x] 3D.3 Present overscroll-background analysis and options; the owner approved static upward coverage on 2026-11-03.

- [x] 3D.4 Add viewport-height upward background coverage to Collection/RSS without altering bounce, scroll handlers or content geometry; confirm the existing 72-point item width.
- [x] 3D.5 Verify layout/scroll regressions, checks and bundles; reload the native app and record the unavailable automated pull-down rendering evidence.

## 3E. Search and Feedback keyboard acceptance

- [x] 3E.1 Restore the original 12-point source-item gaps, retaining other source-strip adjustments.
- [x] 3E.2 Center the painted Search tag chevron and reduce the keyword field to 15-point type.
- [x] 3E.3 Sequence Feedback initial focus after native presentation and settled avoidance geometry; cover one-time focus and unchanged form behavior in the mounted harness.
- [x] 3E.4 Audit bundled bridge provenance/history and compare bridge/Web preprocessing; document omissions without changing bridge code.
- [x] 3E.5 Run checks/bundles and available native verification, preserving unrelated working-tree files.

## 3F. Portable bridge synchronization

- [x] 3F.1 Preserve the programmatic-selection fix present in the incoming upstream fast-forward to 29dceb3; cover suppression plus subsequent user selection.
- [x] 3F.2 Add common image lifecycle/WeChat preservation, span line-break preservation, details exclusion, relative links, table fitting and iframe sizing; cover metadata arrival and cleanup.
- [x] 3F.3 Build bridge through Rollup, update per-file provenance and regenerate Mobile embedding; integrate table CSS and bridge disposal without changing media processing.
- [x] 3F.4 Run upstream tests/typecheck, Mobile checks/bundles, strict specs and runtime verification; preserve both checkouts' unrelated files and document evidence.

## 3G. Android bridge verification and width audit

- [x] 3G.1 Build and run an independent Android fixture using the main-checkout source; exercise images, tables, relative links and annotation paths, distinguishing native input from prepared state.
- [x] 3G.2 Record the intermittent native selection-bar failure, comment keyboard overlap and deliberately blocked fixture browser handoff without claiming full Android acceptance.
- [x] 3G.3 Compare Collection/RSS item and label width constraints with HEAD; retain the unchanged 72-point items and existing approved typography, and preserve unrelated dirty files.

## 3H. Approved Android annotation repairs

- [x] 3H.1 Reproduce touch cancellation before/after debounce in regression tests and route cancellation through the existing pointer-release behavior.
- [x] 3H.2 Reproduce Android keyboard overlap with the installed RN implementation, enable height avoidance and verify changing frames, restoration, already resized parents and unchanged iOS behavior.
- [x] 3H.3 Rebuild upstream bridge, synchronize provenance and regenerate Mobile assets; run upstream and full Mobile checks/bundles.
- [x] 3H.4 Re-verify native Android long press and keyboard-visible comment submission/reopening; record evidence and preserved unrelated files.

## 3I. Approved adaptive source widths

- [x] 3I.1 Record the owner-approved 38-point minimum, 72-point name cap and 22-point gaps for both platforms and both source strips.
- [x] 3I.2 Implement stable intrinsic label sizing across selection, preserving existing typography, avatars and native scrolling.
- [x] 3I.3 Run Mobile checks/bundles, native iOS/Android layout and selection verification, strict specs and preservation audit; record evidence.

## 4. Verification and delivery

The main-checkout code is available for local inspection. The earlier copy-link evidence is historical and superseded; restored native sharing needs fresh exercise. Task 1.2 remains open for the unavailable non-subscriber baseline measurement.

- [x] 4.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; record results and any concrete limitations in `validation.md`.
- [x] 4.2 Record native visual/interaction coverage for both platforms, Chinese/English, light/dark system appearance with the fixed-light Mobile profile, and default/increased text scale; capture before/after evidence outside git and explicitly identify unverified combinations.
- [x] 4.3 The owner exercised the final main-checkout app, accepted the accumulated refinements on 2026-11-03 and authorized review followed by a draft PR; see proposal.md and validation.md.
- [x] 4.4 The owner declined a Mobile version increment on 2026-11-03. Verified version 1.0.26, build 798, previous build 797 remain unchanged; no metadata regeneration is needed. See `validation.md`.
- [ ] 4.5 Complete the Bugs, Security, and Compliance local pre-push review; resolve Important findings, then open the task PR to `dev` with `OpenSpec: mobile-library-reader-polish`, verification evidence and key visuals, and close the review loop.
- [ ] 4.6 After the task PR merges, classify every unchecked task, complete or verify predecessor archival (`mobile-native-smoothness`, then `mobile-ui-polish`) and reconcile the resulting main specs, then archive this change through a separate docs PR; verify strict OpenSpec validation passes.
