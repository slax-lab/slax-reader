## 1. Implement the reviewed behavior

- [x] 1.1 Validate the proposed value at the Web edit boundary before writing or updating the visible row.
- [x] 1.2 Preserve any established explicit reset-to-original action. Fall back to the source title when rendering an existing whitespace-only alias, without bulk rewriting saved rows.

## 2. Verify the user journey

- [x] 2.1 Exercise **Invalid list rename**. When the reader replaces a title with spaces or tabs and confirms or leaves the input, verify that an understandable validation outcome is shown, no blank alias is written and the prior usable title remains available.
- [x] 2.2 Exercise **Correct and retry**. When a reader supplies a valid replacement after a rejected rename, verify that the normal rename path accepts the corrected title.
- [x] 2.3 Exercise **Legacy blank alias**. When an existing article has a nonempty original title and a whitespace-only alias, verify that its library row and reader show a usable title.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
