## 1. Implement the reviewed behavior

- [x] 1.1 Use the same length measure as the existing write contract.
- [x] 1.2 Apply it after the same normalization as submission on all Web composition paths. Allow over-limit paste for correction, expose feedback to assistive technology, and guard both Enter and button submission.

## 2. Verify the user journey

- [x] 2.1 Exercise **Oversize reply**. When the reader pastes a 1,501-unit reply and presses Enter or clicks Send, verify that the draft is retained with an actionable length message and no mutation is queued or submitted.
- [x] 2.2 Exercise **Boundary**. When the reader shortens the draft to exactly 1,500 units and submits, verify that the valid comment can be saved and a subsequent valid edit proceeds.
- [x] 2.3 Exercise **Unicode and input methods**. When a draft includes emoji or is being composed with an IME, verify that the committed draft uses the existing UTF-16 measure and intermediate composition does not trigger an unintended send.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
