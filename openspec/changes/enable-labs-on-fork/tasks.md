## 1. Proposal Review

- [x] 1.1 Obtain the change requester's review of the proposal and acceptance scenarios in the conversation or local files before editing runtime code.

## 2. Fork Publication

- [x] 2.1 Declare the eligible content kinds in the existing Lab registry and use one resolver from both Fork copy paths. Update the existing domain tests to verify matches, ordinary content with no match, historical YouTube recognition, and admission with the matching Lab disabled.
- [x] 2.2 Enable the resolved Lab within the existing publication transaction for created and refreshed copies. Verify in repository tests that a publication error rolls back the Lab write, an enabled row keeps its timestamp, and an existing-item response without publication leaves preferences untouched.

## 3. Verification

- [x] 3.1 Exercise the acceptance scenarios using the existing Fork HTTP smoke and synchronous Fork tests. Use `FORK_SMOKE=1 pnpm api -- test:http` to verify the real online copy lifecycle for Labs-off accounts, ordinary article Forks, and a failed publication. Check the account's Labs state while the copy is pending and after it finishes.
- [x] 3.2 Run backend generation with `pnpm api -- gen:all`, the applicable API lint, typecheck and tests, `pnpm api -- test test/script/layerArchitecture.test.ts`, and `openspec validate --all --strict`. Record results and running-environment evidence in `validation.md` and complete the local review in `REVIEW.md` before proposing a pull request.
