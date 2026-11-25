## 1. Implement the reviewed behavior

- [x] 1.1 Capture the originating interface language for the current sign-in attempt.
- [x] 1.2 Compare after account preference resolution. Present the choice in the originating language and use the existing preference writer only on affirmative selection. Avoid inferring account age or changing all returning readers' preferences.

## 2. Verify the user journey

- [x] 2.1 Exercise **Different languages**. When a reader starts sign-in in Chinese and returns with an English account preference, verify that the reader receives a Chinese-language choice that can select Chinese or retain English.
- [x] 2.2 Exercise **Existing preference**. When the reader keeps English or dismisses the offer and refreshes, verify that English remains selected and the same completed sign-in does not prompt again.
- [x] 2.3 Exercise **Matching language**. When the account language already matches the originating Web language, verify that sign-in continues without an extra language prompt.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
