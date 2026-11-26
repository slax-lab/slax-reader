# Tasks

## 1. Deployment

- [x] 1.1 Add the `vector` target: name from `services.VECTOR_SEARCH.service` or derived from Core's, `VECTOR_REGION = 'aws:us-east-1'`, generated configuration with only `VECTOR_V5_ARTICLE`, no routes or public hostname, and AI's `VECTOR_SEARCH` service binding (default entrypoint).
- [x] 1.2 Publish Vector before AI in the normal and bootstrap orders; give it a local dev port.
- [x] 1.3 Add `RUNTIME_KEYS.vector`; include Vector in the requirement check and `secrets:sync`; let only a single-Worker release create a Worker that does not exist yet.
- [x] 1.4 Cover the new target in `release`, `deployPaths`, `workerTopology`, `rootDeployment`, `devPortGuard` and secret-sync tests.

## 2. Vector Worker

- [x] 2.1 Add `src/const/vectorSearch.ts` with the internal host, path and request/response types.
- [x] 2.2 Move the V5 candidate scoring into one function used by Vector and by AI's in-process fallback.
- [x] 2.3 Add `src/entry/vector/index.ts`: secret check, host/path/method/body validation, embedding, one query with values, mean-centered scores and timings; 403/404/400 otherwise.

## 3. AI search

- [x] 3.1 Start the Vector fetch first for untagged searches (5 s timeout) and fall back in-process when the binding is absent; run the up-front ownership list only for tag-filtered searches.
- [x] 3.2 Apply ownership, the 0.35 floor and the 0.6 relative bound after admission.
- [x] 3.3 Log each phase's timing (Vector call, embedding and query inside Vector, candidate preparation, fulltext, admission).
- [x] 3.4 Update `searchHighlightSecurity.test.ts`: concurrency order, bounds after admission with a trashed best match, Vector failure, missing binding fallback.

## 4. Verification

- [x] 4.1 `pnpm api -- gen:all`, typecheck, full test suite, layer architecture test, `pnpm api -- build`, `openspec validate --all --strict`.
- [x] 4.2 Update the deployment documentation (EN/CN/JP) for the sixth Worker and the first-release steps.
- [x] 4.3 Local `REVIEW.md` review before push.
- [ ] 4.4 After the operator creates the Worker and syncs its values, merge; on the test account, measure `/v1/bookmark/search` with `wrangler tail` on AI and Vector (40 requests, fresh and repeated keywords) against the recorded baseline, and record it in `validation.md`.
