## 1. Implement the reviewed behavior

- [x] 1.1 Use a request generation local to the results view.
- [x] 1.2 Ignore obsolete success, failure and finally handlers. Render an explicit failed state with a retry action and distinguish it from a successful empty result. Use the existing request layer without showing raw transport text for this search.

## 2. Verify the user journey

- [x] 2.1 Exercise **Reordered success**. When Rust starts before JavaScript but resolves after JavaScript succeeds, verify that the heading, count and rows continue to describe JavaScript.
- [x] 2.2 Exercise **Latest search fails**. When Images fails after a successful Rust search, verify that the Images input remains editable, Rust rows and count disappear, and retry runs Images.
- [x] 2.3 Exercise **Stale failure and empty success**. When an earlier request fails after a later search successfully returns zero matches, verify that the empty state belongs to the latest search and no stale error or spinner replaces it.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
