# Tasks

## 1. Preference model and design contract

- [ ] 1.1 Define the four preference identifiers and compatible palette choices in the client owners. Test defaults, switching paper with automatic ink, refusing an incompatible explicit combination, and resetting only appearance.
- [ ] 1.2 Amend the Web typography and Mobile light-reader clauses in DESIGN.md for opt-in article styling; verify the theme matrix retains existing shell and default responsibilities.

## 2. Web article reader

- [ ] 2.1 Add localized appearance controls to existing reader actions for saved and public HTML articles. Verify all four groups, selected states, keyboard operation, focus return and reset at desktop and narrow widths.
- [ ] 2.2 Persist choices locally and apply scoped paper and prose styles to ordinary and isolated article renderers. Verify immediate updates, refresh, a second article, public reading without login, and unchanged shell and PDF behavior.
- [ ] 2.3 Preserve passage and annotation anchors through text reflow. Use an article with mixed Chinese/English, a marked paragraph, code and links to verify selection and navigation after changes.

## 3. iOS and Android reader

- [ ] 3.1 Add the localized Reading appearance entry to the HTML reader More panel and bind both the panel and reader to local PreferenceStore values. Verify changing an option, native dismissal, restart and reset independently on both platforms.
- [ ] 3.2 Style the contiguous native reading surface and update the mounted HTML document in place. Verify a marked passage remains in view with each platform's scroll owner and an existing cached article opens offline using the chosen appearance.
- [ ] 3.3 Verify the PDF reader has no ineffective appearance controls, the library keeps its theme and existing More actions, selection, marks and embedded media remain usable.

## 4. Cross-platform acceptance

- [ ] 4.1 Run the relevant Web and Mobile test/build commands and OpenSpec strict validation. Record actual browser and native results in validation.md, including Web light/dark/e-ink, desktop/768px/narrow widths, accessible control names and iOS/Android mixed-script rendering.
- [ ] 4.2 Prepare running clients for hands-on acceptance by the change requester. Record feedback and retest adjustments before a PR; confirm the Mobile version decision and complete repository pre-push review before delivery.
