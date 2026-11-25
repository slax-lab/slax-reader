

## PR #572 security review follow-up

The first automated review of the original implementation found an Important privacy defect: quoted detail spanning a newline could bypass redaction. Rather than expanding the regex, the final implementation **does not log arbitrary provider detail at all**. It retains the structured provider code and only static safe labels for `INPUT_TOKEN_LIMIT_EXCEEDED`, `INVALID_TASK` and `AUTH_INVALID_API_KEY`. Unknown codes retain no provider detail. Structured detail objects are ignored rather than serialized. The request ID header fallback now applies even when a detail label exists.

Regression tests cover multi-line article excerpts, structured detail arrays, arbitrary provider details and header fallback. All 30 focused tests and all 3,904 full-suite tests passed after the change. Typecheck, lint, strict specs and four Worker builds also passed. The earlier Important finding is addressed without retaining any potentially sensitive provider text; no Important finding remains. No deployment or replay occurred.

Remaining non-blocking observations: provider detail shapes are intentionally ignored rather than transformed; the PR-only design is explicit. The existing cron-context warning belongs to the earlier collection work, not this diff.

## Final-failure-only diagnostics follow-up

Production logs showed the `[embedding-provider]` error line firing for Jina 400 responses that belonged to batch attempts later subdivided and completed successfully. The client now carries the diagnostic on `EmbeddingProviderError` instead of logging it per request. `VectorMaintenanceService` reports it from its terminal failure path and `HybridSearchService` reports it when a search query fails; both report at most once per error instance, so a retried-then-succeeded attempt emits no provider error log.

Focused verification on the `dev`-based branch:

```sh
pnpm api -- test test/utils/vectorEmbedding.test.ts test/domain/vectorMaintenance.test.ts
# 166 tests passed
```

The tests cover a batch rejected with 400 and subdivided into one failed and one written article (exactly one `[embedding-provider]` log), a terminal single-request 400 (one log), report deduplication, non-provider errors staying silent and successful requests staying silent. Typecheck, lint, the layer-architecture check and `openspec validate --all --strict` also pass; full results are recorded in the pull request's Test plan.

Not verified: no deployed environment replay. Production logs were read only to establish that the observed 400s were intermediate attempts; the log behavior itself is exercised by the tests above through the real client and maintenance service.

Generation note: `gen:all` cannot run end to end here because the worktree has no `deploy/local/api.toml` for the Worker-types step. The DI, cron, consumer and router generators were run individually and produced no diff after the usual Prettier pass; the change adds no DI component, service constructor, cron, consumer, router or Worker binding, so `worker-configuration.d.ts` is unaffected.

Review follow-up on PR #735: the automated review reported no Important findings and two Nits, both taken. `embedWithinBudget` now keeps the provider diagnostic when a context overflow cannot be subdivided further (`pending_multimodal_context_overflow`, `input_cannot_be_split`), so those terminal conversions still emit the final provider diagnostic. `hybridSearch.test.ts` now covers the search reporting path: one diagnostic for an `EmbeddingProviderError`, silence for a non-provider rejection and for a pre-aborted signal. Re-ran the three focused suites (216 passed), typecheck and lint; results recorded in the pull request.

Second review round on PR #735 reported one Important finding: `SearchService.semanticSearchV5` calls `cachedQuery` outside `HybridSearchService`, and the orchestrator swallows that rejection, so the V5 search path lost the diagnostic that the client used to log. `semanticSearchV5` now reports the provider failure before rethrowing, with a direct test in `searchHighlightSecurity.test.ts`. The remaining Nit — image-specific provider rejections stay silent — is intentional and documented in `design.md`: those errors are recorded as skipped images, not target failures. Re-ran the four focused suites plus typecheck and lint; results recorded in the pull request.
