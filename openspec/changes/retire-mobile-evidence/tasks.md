# Tasks

## 1. Retire evidence validation

- [x] 1.1 Inventory every external reference to the former mobile evidence directory across documentation, fixtures, tooling, tests, and OpenSpec changes.
- [x] 1.2 Delete the evidence coverage ledger, native-evidence verifier, evidence-only CI job, scope output, and associated tests.
- [x] 1.3 Simplify the baseline verifier so source-manifest, asset, localization, and fixture checks remain without coverage or native-evidence validation.
- [x] 1.4 Verify the remaining Mobile checks, tooling tests, and `openspec validate --all --strict` pass.

## 2. Remove external references

- [x] 2.1 Remove evidence sections and links from `docs/mobile` and `docs/CI.md`; retain setup, source baseline, fixture, and release guidance.
- [x] 2.2 Remove evidence paths from fixture guides, plans, scripts, and adoption reports, replacing historical references with an explicit retirement note.
- [x] 2.3 Clean evidence references from active OpenSpec changes without altering unrelated implementation requirements.

## 3. Delete artifacts and archive completed changes

- [x] 3.1 Delete the mobile evidence directory from the current tree.
- [x] 3.2 Record the user's manual acceptance of `expo-mobile-migration` and its evidence retirement, then archive it together with the completed Mobile application changes.
- [x] 3.3 Keep incomplete or unaccepted Mobile changes active and record any deferred archive decisions in the pull request.

## 4. Final verification

- [x] 4.1 Run the remaining Mobile baseline checks, Mobile CI, tooling tests, and strict OpenSpec validation.
- [x] 4.2 Audit the repository for external references to the deleted evidence directory and confirm none remain.
- [x] 4.3 Record that Git history rewriting is out of scope and that historical clone-size reduction requires a separate operation.
