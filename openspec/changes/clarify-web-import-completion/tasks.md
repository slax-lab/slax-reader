## 1. Implement the reviewed behavior

- [x] 1.1 Use raw current_count and batch_count for the finalizing decision.
- [x] 1.2 Avoid rounding a partial batch up to 100%. Continue the existing polling until the supplied task state is terminal. Keep success and failure counts visible.

## 2. Verify the user journey

- [x] 2.1 Exercise **All rows accounted for**. When the active task reports one processed row out of one, verify that the reader sees finalizing and the counts, without a claim that the task has completed.
- [x] 2.2 Exercise **Last fraction**. When an active task has 199 of 200 rows processed, verify that the progress display still distinguishes it from a fully processed batch.
- [x] 2.3 Exercise **Terminal update**. When a later refresh or reopened modal receives complete or failed status, verify that the matching terminal state replaces finalizing and retains the reported counts.
- [x] 2.4 Add focused regression coverage for the branches above and run the affected suite. Record running-environment evidence in `validation.md`.
- [x] 2.5 Obtain hands-on acceptance of the changed Web surface before opening the task PR. Run `openspec validate --all --strict` and the repository pre-push review.
