# Verification

## Incident replay

On November 5, 2026, the original Gemini 3 Flash preview prompt returned 242 references for 241 cues in the first chunk of fsTtKywmWlU. It attributed a mixed-speaker cue to two paragraphs and moved a guest interjection after the host's question. The earlier workflow rejected six responses in production. Those historical responses were unavailable for inspection.

Ran the changed runYoutubeArticle locally on the full authenticated R2 input with an empty temporary object store and the production model, schema, thinking level, temperature and token limits. With the ordinary v2 payload, the workflow runner planned eight chunks, edited, translated, wrote its introduction, passed quality checks, rendered JSON/HTML/text, verified object presence and reached ready. A separate read of the generated JSON and HTML found all 1,687 cue IDs exactly once in input order. All 17 chapter seek times matched their first cue. Inspection of c0013 and c0020 confirmed the greeting, reply, interjection and subsequent question stayed in order.

| Final run | Result |
| --- | --- |
| Chinese article | 17 chapters, 129 paragraphs |
| Calls and elapsed time | 17 replies from 22 attempts in 68.8 seconds (five transport errors retried) |
| Estimated model spend | USD 0.12873 |
| Gate | No failed checks. Language ratio 1.0, number coverage 0.895 and length ratio 0.420 |
| Conservative source fallback | 27 passages used caption wording. Such passages can retain speech markers or disfluencies. |

## Previously successful article

In the earlier passage-editor comparison, read the existing English article for UNzCG3lw6O0 and replayed its canonical captions locally with the new editor. Both results reference the same 597 cues in the same order. The old article has eight sections and 50 paragraphs. The local result has seven sections and 36 paragraphs, matching seek anchors and passing the quality gate with full numeric coverage. Compared the opening and later section headings against their source ranges. The local runner used four responses in 13.9 seconds and an estimated USD 0.02676. The older published workflow recorded USD 0.05122. These individual runs use different execution environments.

## Automated verification

- API Vitest suite: 2,845 passed; 117 environment-dependent or explicitly skipped tests.
- API and contract typechecks passed. Changed source ESLint passed. API gen:all produced no tracked output drift.
- Strict repository-wide OpenSpec validation: 108 passed. Staged diff whitespace check passed.
- Forced omitted sentences, reordered text and a changed negative number to exercise source fallback. Returned translation fields in partial batches, then threw a timeout, reconstructed the stage from storage and checked only the outstanding key was requested. Completed stage replay issued zero provider calls.
- The runner suite exercises the existing workflow payload directly, including v2 source fallback, keyed response reordering, truncation, translation retry and bounded source context.

## Boundaries and pre-push review

Local replay used a filesystem object store, a step adapter, an in-memory row and publication callbacks. Live Gemini, article generation and rendered outputs were exercised. Production scheduling, database writes, browser playback and deployment were outside this run. The existing production bookmark has not been restarted. Passing the structural and language checks does not establish word-for-word translation accuracy.

Local Bugs/Security/Compliance review covered retry boundaries, old payloads, budgets and cleanup, source references, private input handling, rendering, the approved scope and evidence. Reviewed the direct v2 replacement, including final-chunk reuse and unversioned intermediate checkpoints. No remaining Important findings.
