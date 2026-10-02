# Tasks

## 1. Article discovery and provider selection

- [x] 1.1 Add a bounded X Article URL detector that prefers expanded entities, falls back to tweet text, resolves only unresolved t.co links, and rejects non-X article URLs; verify with the reported status and ordinary-link unit cases.
- [x] 1.2 Route a status that references an X Article through the existing fxembed path, validate that the returned document contains usable article content, and fall back to the article API with the original status ID; verify provider order and ID arguments with focused tests.
- [x] 1.3 Preserve ordinary tweet output and source URL when article discovery or both providers fail; verify the fallback behavior with regression tests.

## 2. Validation and documentation

- [x] 2.1 Run the focused backend tests and the complete backend test suite; verify no existing Twitter, parser, or workflow tests regress.
- [x] 2.2 Run `openspec validate --all --strict` and review the final diff against the proposal, design, spec, and task checklist.

Validation results and outstanding environment-dependent checks are recorded in `validation.md`. These checkboxes record the implementation and review work; the complete backend suite is not green in this sandbox.
