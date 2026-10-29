# Tasks

## 1. Capture

- [x] 1.1 Add source recognition and page parsing with failing-then-passing fixture tests for episode, show, unsafe audio, and transcript cases.
- [x] 1.2 Connect the parser to browser fetching and the existing save flow; verify player output, source identity, and annotation protection.

## 2. Verification

- [x] 2.1 Parse the reported live episode page and record the resulting audio, title, and duration; state provider and paid-generation limits.
- [x] 2.2 Run focused tests, type checks, lint, generation, strict OpenSpec validation, and local review; record results.
- [x] 2.3 Record human hands-on acceptance. Luca confirmed acceptance on 2026-10-28; no UI changes were required. See `validation.md` for scope and remaining production verification gaps.
- [ ] 2.4 Archive through a documentation PR after the task PR merges. `add-bookmark-fork` also carries a `podcast-article` delta and still has open tasks (3.2, 4.5, 6.3); classify those tasks and archive that change first, or archive both changes in one sequenced documentation PR, so the living spec receives the two deltas in order.
