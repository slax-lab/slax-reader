## 1. Implement the reviewed behavior

- [x] 1.1 Build the format guidance from the selected source's existing accept list.
- [x] 1.2 Keep cancellation silent. Show size, parse and file-read errors through their own applicable paths and continue to validate actual content in preview.

## 2. Verify the user journey

- [x] 2.1 Exercise **Wrong extension**. When a reader selects notes.txt for Pinboard, verify that the page names the unsupported type, lists JSON, HTML/HTM and XML, and can reopen the picker.
- [x] 2.2 Exercise **Corrected selection**. When a supported valid export is chosen immediately afterward, verify that the format error clears and the preview opens.
- [x] 2.3 Exercise **Cancelled selection**. When the picker is closed without choosing a file, verify that no format or missing-file error is added.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
