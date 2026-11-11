# Tasks

## 1. Available source processing

- [x] 1.1 Separate stored text, HTML and image availability, include media state in reuse fingerprints, and verify missing-sibling and restored-image regression tests.
- [x] 1.2 Classify confirmed provider image content failures, isolate rejected images and deterministic text batch inputs, and verify valid siblings survive while service/auth failures remain errors.

## 2. Incremental owner state

- [x] 2.1 Store applied vectors and indexed publication timestamps in the existing owner object, bootstrap legacy state once, and verify replace/delete without previous remote vectors never rereads full history.
- [x] 2.2 Publish available user and Collection coverage, isolate malformed records, remove stale zero-usable projections, and verify partial/recovered/empty states and unchanged identity boundaries.
- [x] 2.3 Maintain the bounded recent-action window and current interest clusters from local contributions; verify save/star/delete/expiry and assert no ordinary history or recent-window SQL scan.
- [x] 2.4 Remove full-member timestamp aggregation from Collection publication and verify timestamps against full-reference results after update/removal.

## 3. Events and convergence

- [x] 3.1 Route relation-only changes directly to incremental owner maintenance and verify missing original content cannot block star/share/delete updates.
- [x] 3.2 Propagate explicit article repairs through the existing Workflow, isolate partial publication outcomes, and verify repeated repair converges without duplicate weights or subscriber fan-out.
- [x] 3.3 Separate accepted chunk cleanup from asynchronous visibility and verify delayed delete/shrink does not rerun successful embedding or fail after subsecond polling.

## 4. Verification and handoff

- [x] 4.1 Replace conflicting old assertions, run owner runtime and integrated regression cases for every audited omission, and verify the same behavior through a running local environment.
- [x] 4.2 Run standard API generation, typecheck, full tests, lint and four-Worker dry-run builds; inspect generated diff and record commands, results and gaps in validation.md.
- [x] 4.3 Reconcile superseded normative restrictions, pass strict OpenSpec validation and Bugs/Security/Compliance review, and confirm no production mutation, deployment, unrelated code or temporary output remains.
