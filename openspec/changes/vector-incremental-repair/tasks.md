# Tasks

## 1. Available source processing

- [x] 1.1 Separate stored text, HTML and image availability, include media state in reuse fingerprints, and verify missing-sibling and restored-image regression tests.
- [x] 1.2 Classify confirmed provider image content failures, isolate rejected images and deterministic text batch inputs, and verify valid siblings survive while service/auth failures remain errors.

## 2. Incremental owner state

- [x] 2.1 Keep indexed publication timestamps with each owner entry, bootstrap absent state once in bounded pages, and verify replace/delete never rereads full history (storage location and old-vector handling are defined by 2.5).
- [x] 2.2 Publish available user and Collection coverage, isolate malformed records, remove stale zero-usable projections, and verify partial/recovered/empty states and unchanged identity boundaries.
- [x] 2.3 Stop freezing interest clusters: recompute them over the bounded recent-action window and assert no full-history scan (when the window is read is defined by 2.7).
- [x] 2.4 Remove full-member timestamp aggregation from Collection publication and verify timestamps against full-reference results after update/removal.
- [x] 2.5 Move preference state to D1 (migration 00066, `D1PreferenceStore`), drop stored contribution vectors and action history, hand the replaced vector over from content refresh, relation deletion and the repair route, and verify exact subtraction, rebuild-on-unknown-token and no stored vectors.
- [x] 2.6 Make the Durable Object a serializer only: move v2/v3 object state to D1 without history reads, erase object storage, and verify with real Workerd D1 and Durable Object storage.
- [x] 2.7 Recompute interest clusters from the bounded PostgreSQL window on rebuild/refresh only; verify ordinary events carry clusters and medoid deletion drops its cluster.

## 3. Events and convergence

- [x] 3.1 Route relation-only changes directly to incremental owner maintenance and verify missing original content cannot block star/share/delete updates.
- [x] 3.2 Propagate explicit article repairs through the existing Workflow, isolate partial publication outcomes, and verify repeated repair converges without duplicate weights or subscriber fan-out.
- [x] 3.3 Separate accepted chunk cleanup from asynchronous visibility and verify delayed delete/shrink does not rerun successful embedding or fail after subsecond polling.

## 4. Verification and handoff

- [x] 4.1 Replace conflicting old assertions, run owner runtime and integrated regression cases for every audited omission, and verify the same behavior through a running local environment.
- [x] 4.2 Run standard API generation, typecheck, full tests, lint and four-Worker dry-run builds; inspect generated diff and record commands, results and gaps in validation.md.
- [x] 4.3 Reconcile superseded normative restrictions, pass strict OpenSpec validation and Bugs/Security/Compliance review, and confirm no production mutation, deployment, unrelated code or temporary output remains.
