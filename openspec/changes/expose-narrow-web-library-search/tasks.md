## 1. Implement the reviewed behavior

- [x] 1.1 At compact widths replace the hidden entry with a labeled button that reveals and focuses the same search input.
- [x] 1.2 Provide a clear dismissal action that returns focus. Reuse the current bookmark search, avoiding a separate mobile results implementation.

## 2. Verify the user journey

- [x] 2.1 Exercise **Phone browser**. When a reader opens the Web library at 390px, activates Search and submits a keyword, verify that the input takes focus and the matching results are visible without horizontal scrolling.
- [x] 2.2 Exercise **Breakpoint and keyboard**. When the reader navigates with a keyboard at 320px, 860px and just above the breakpoint, verify that one search entry is reachable, it has an accessible name, and dismissal restores usable focus.
- [x] 2.3 Exercise **Embedded view**. When the Web library is displayed in an App browser and the on-screen keyboard opens, verify that the query and submit or return action remain usable.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.

## 3. Compact styling follow-up

- [x] 3.1 Center the input in the compact library toolbar and style the dismissal and submit controls separately from the field using Web theme tokens.
- [x] 3.2 Verify the revised toolbar in the running library, including the narrow breakpoint and all three core themes.
- [x] 3.3 Obtain hands-on acceptance of the revised presentation before opening a follow-up pull request.
