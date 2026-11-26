# Add dialog return focus verification

## Browser exercise

November 25, 2026, Chrome 157.0.8103.79 on macOS, in an isolated local component fixture.

At 390 × 844, Enter opened the Add dialog from the library floating button and focused the URL field. Escape restored focus to the floating button; another Enter immediately reopened it. Cancelling the Feed entry using Close returned focus to the alternate opener, and Tab moved to its next sibling. A controlled successful PDF submission focused the destination; completing the modal leave transition left it there.

Chrome mounted the production modal and floating button with a fixture Feed opener and a controlled PDF response. The integration suite exercises the actual FeedPanel and RSS launch controls.

## Automated checks

- Vitest, BookmarkList/AddUrlTopModal — 38 tests passed. The local Vitest configuration reused the repository test settings and allowed Vite to resolve the shared worktree dependency store.
- Vitest, `tests/integration/pages/bookmarks/index.spec.ts` — 67 tests passed, including real RSS entry buttons passing their specific opener to the modal.
- ESLint on changed Web source and test files — zero errors, 28 warnings in existing lines.
- `openspec validate --all --strict` — 175 passed, 0 failed.

## Change review

On 2026-11-25, a subagent reviewed the implementation against the existing names, module boundaries, call direction, and approved OpenSpec. Claude Opus 5.5 reviewed edge cases. The combined Web tree passed TypeScript, strict OpenSpec validation (190 items), and 557 tests across 29 affected suites.

## Pull request acceptance

The follow-up CI regression test verifies that both RSS Add launchers emit their own click event so the Inbox can restore focus to the correct button. The focused Web run passed 63 tests across five suites.

On 2026-11-25, the change requester confirmed hands-on acceptance of the implemented Web UX batch in the local acceptance environment and authorized opening the pull request. The requester asked for no adjustments.
