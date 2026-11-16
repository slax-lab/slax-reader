# Tasks

## 1. Fix the transcription request

- [x] 1.1 Add a regression test whose fetch rejects a bound `this`; verify it fails on `dev`.
- [x] 1.2 Call the stored fetch without binding it to the client; verify the test passes.

## 2. Verify and hand off

- [x] 2.1 Run the real client in workerd with the API runtime compatibility settings; verify `dev` fails and the fix submits the request.
- [x] 2.2 Run API type check, lint, tests, and `openspec validate --all --strict`; record results in `validation.md`.
- [ ] 2.3 Run a real AssemblyAI transcription on the deployed `dev` environment after merge; record the job result.
- [ ] 2.4 Archive through a documentation PR after this PR merges, after `add-bookmark-fork` and `capture-pocket-casts`; classify unchecked tasks first.
