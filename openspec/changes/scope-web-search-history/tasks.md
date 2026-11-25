## 1. Implement the reviewed behavior

- [x] 1.1 Namespace recent terms by the established stable Web account key.
- [x] 1.2 Ignore and remove the unowned legacy list because it cannot be attributed to a reader. Clear the old view before loading the next account. Preserve the five-term limit and per-account Clear action.

## 2. Verify the user journey

- [x] 2.1 Exercise **Shared browser**. When account A searches for a term, signs out and account B focuses an empty search box, verify that B sees none of A's terms.
- [x] 2.2 Exercise **Switch back and clear**. When A signs back in, clears recent searches and later returns to the same browser, verify that A's saved terms are gone and B's history is unchanged.
- [x] 2.3 Exercise **Legacy profile**. When a profile has only the old unscoped history key when first used after the change, verify that its terms are not assigned to any account or shown while identity is unresolved.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
