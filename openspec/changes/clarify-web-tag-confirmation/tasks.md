## 1. Implement the reviewed behavior

- [x] 1.1 Choose localized labels from pending.size.
- [x] 1.2 Keep attachedIds and the existing submit and transport logic. With no additions Done dismisses the panel. With additions the action names their count and commits them.

## 2. Verify the user journey

- [x] 2.1 Exercise **Reopen an edited article**. When an article already has a tag and its editor is reopened, verify that the attached tag is marked and the confirmation control says Done without a zero count.
- [x] 2.2 Exercise **Select two additions**. When the reader selects two more tags and confirms, verify that the control describes two additions and reopening shows all three attached.
- [x] 2.3 Exercise **Failed write**. When the addition fails while the editor is open, verify that the pending selections remain visible and retryable.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
