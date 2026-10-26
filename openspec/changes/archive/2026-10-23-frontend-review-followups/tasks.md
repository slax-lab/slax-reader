# Tasks

## 1. CI and environment verification

- [x] 1.1 Record absent/empty/placeholder environment type-check outcomes in this change's verification notes and enable real CI app checks after validating placeholders.

## 2. Review fixes

- [x] 2.1 Export the Axios subpath and verify a consumer import and request using a fake adapter.
- [x] 2.2 Forward repeated signals and verify repeated SIGINT/SIGTERM plus cancelled SSR startup with subprocess tests.
- [x] 2.3 Restore dependency build restrictions; verify clean installation, Sharp/protobufjs runtime smoke checks, and both frontend builds.

## 3. Final verification

- [x] 3.1 Run relevant tooling and frontend tests plus openspec validate --all --strict; record outcomes and remaining limits. Consolidate duplicate VueUse mocks found during the bookmarks integration test run.
- [x] 3.2 Run the Bugs, Security, and Compliance review using frontend-review-followups and resolve Important findings before pushing the pull request branch.
