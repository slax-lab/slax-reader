## 1. Implement the reviewed behavior

- [x] 1.1 Compare normalized input with candidate display names at search and creation time.
- [x] 1.2 Preserve stable IDs. Where legacy case variants coexist, list them as separate selectable records and require an explicit selection rather than choosing one arbitrarily or merging historical data.

## 2. Verify the user journey

- [x] 2.1 Exercise **Existing tag differs only by case**. When Rust exists and a reader types rust, verify that Rust remains selectable and a create-rust action is absent.
- [x] 2.2 Exercise **Historical variants**. When Rust and RUST already exist and the reader enters a case-equivalent query, verify that both existing identities can be distinguished and selected, and neither is implicitly merged or newly created.
- [x] 2.3 Exercise **New name**. When no available tag matches the entered name ignoring case, verify that creation remains available with the spelling the reader supplied.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
