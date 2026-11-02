# Tasks

## 1. Proposal review

- [x] 1.1 Record human review of the concurrent processing proposal before implementation.

## 2. Concurrent runner

- [x] 2.1 Add failing tests for five active chunks, completion in another order, and per-chunk edit-before-translation order.
- [x] 2.2 Implement deterministic batches and source-based context. Preserve cache keys, split recovery, and coverage checks.
- [x] 2.3 Add failing tests for concurrent budget admission, settlement errors, and waiting for reservations before budget refusal.
- [x] 2.4 Implement budget reservations and serialized accounting without serializing provider calls.
- [x] 2.5 Test sibling settlement after failure, cached results on retry, workflow replay, and loss of the run lease.
- [x] 2.6 Add model-call and chunk duration events. Test that events contain no transcript text.

## 3. Verification

- [x] 3.1 Run focused tests, API tests, typecheck, and changed-file lint. Record failing-before and passing-after evidence.
- [x] 3.2 Exercise a multi-chunk runner in a running environment with delayed responses. Compare sequential and concurrent timing and output order.
- [x] 3.3 Check authorized real-model access and record the exact gap: no Vertex credential or dev workflow access.
- [x] 3.4 Record evidence in validation.md, add a dated change log, and pass strict OpenSpec validation and diff checks.

## 4. Review and delivery

- [x] 4.1 Run an independent Bugs, Security, and Compliance review. Resolve Important findings before pushing.
- [ ] 4.2 Open one PR to dev using the repository template and the validation evidence.
- [ ] 4.3 Resolve PR agent findings and CI failures until the agent review gate passes on the final revision.
- [ ] 4.4 After the task PR merges, classify remaining tasks and archive through a documentation PR after the preceding truncation change.
