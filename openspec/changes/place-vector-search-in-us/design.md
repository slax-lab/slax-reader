# Design

## Context

See proposal.md (Why) for the measurements. Today `SearchService.hybridSearch` (AI Worker, `aws:ap-southeast-1`) runs three phases in sequence: the up-front PostgreSQL ownership list (`getSearchEligibleBookmarks`), candidate preparation (three KV reads with PostgreSQL/D1 fallbacks, plus jieba tokenization), and then the fulltext and semantic branches in parallel, followed by admission. The semantic branch (`semanticSearchV5`) waits for both earlier phases although it needs only the keyword and the user id, and its embedding and Vectorize calls each cross the Pacific.

The deployment script owns every Worker's name, bindings and placement (`apps/api/script/deploy/config.ts`); private configuration may not set placement, and every Worker's runtime values are checked before publication (`runtimeKeys.ts`, `topology.ts`).

## Goals / Non-Goals

- Goal: the untagged semantic branch costs one service-binding round trip plus US-local embedding and query, and overlaps everything else in the request.
- Non-goal: moving `/v1/search`, recommendation, vector maintenance or the legacy buckets; changing scoring, thresholds, candidate count, embedding cache keys or the response.

## Decisions

### D1. A sixth Worker, not a Durable Object or a second AI placement

A Durable Object with `locationHint: 'enam'` would also run in the US, but a single object serializes requests, so it would need sharding, and the hint is honored only at first creation. A separate stateless Worker scales per request and gets an exact placement region from the deployment script. Moving the whole AI Worker would make PostgreSQL, D1, KV and jieba cross the ocean.

### D2. One internal fetch that does the whole semantic step

Cloudflare applies placement only to `fetch` handlers; an RPC method or named entrypoint runs beside the caller. The call therefore follows the Core jobs pattern (`src/const/jobs.ts`): a `fetch` over the service binding to an internal host.

- `src/const/vectorSearch.ts` defines `VECTOR_SEARCH_HOST = 'vector.internal'`, `VECTOR_SEARCH_PATH = '/search'` and the request and response types, shared by AI and Vector.
- `src/entry/vector/index.ts` exports only a default `fetch`. It answers 403 unless `EDGE_SECRET_HEADER` equals `EDGE_SHARED_SECRET`, 404 for any other host, path or method, and 400 for an invalid body: `userId` a positive safe integer and `keyword` a non-empty string of at most 500 characters (the `/v1/bookmark/search` limit). For a valid request it embeds the keyword with `VectorEmbeddingClient.query`, queries the article index with `filter { kind: 'article', user_id }`, `topK 50`, `returnValues: true`, and responds with every candidate's mean-centered cosine (`center`, `cosineSimilarity` from `recommendationAlgorithms.ts`), sorted by score then id, plus the embedding and query timings. The floor and the relative bound are not applied here (D4).
- The scoring itself lives in one domain function used by both Vector and AI's in-process fallback (D6), so the two paths cannot drift.
- The Worker imports only these modules plus `VectorIndexRepo`, so it carries no registry, Prisma or WebAssembly.

The embedding KV cache is not used: the Worker has no KV binding, a cross-region KV read costs about as much as a US-local Jina call (81 ms median), and a fresh keyword, the slow case, never hits it.

### D3. AI starts the call first and joins at admission

For untagged searches `hybridSearch` starts the `VECTOR_SEARCH` fetch with `{ userId, keyword }` before anything else, then runs candidate preparation and fulltext ranking as today, and awaits both at the point where the branches currently join. The up-front `getSearchEligibleBookmarks` call runs only for tag-filtered searches. Without it, fulltext candidates are still restricted by `getUserBookmarkItem`'s current-bookmark set (`valid_bm_ids`, cached five minutes and cleared on change), and the final `getSearchEligibleBookmarks(userId, tags, matchedIds)` remains the authority for ownership and trash state.

Alternatives: keep the up-front list and only move the semantic call (still waits ~0.3 s for PostgreSQL); an RPC entrypoint (ignores placement, so it would run in Singapore); call Vector from Core (search is an AI route).

### D4. Bounds after admission

Today `semanticSearchV5` filters candidates by the up-front list before computing `top` and keeping scores ≥ `0.6 × top`. Without that list, a trashed bookmark could set `top`. AI therefore receives unbounded scored candidates, drops ids absent from the admission result, and only then applies `SEMANTIC_MIN_TOP_SCORE` and `SEMANTIC_RELATIVE_FLOOR`. The admission query already covers semantic ids, so this adds no query; it reorders one filter. Results equal today's for the same candidates.

### D5. Deployment identity, placement and secrets

- Target `vector` joins `TARGETS`. Its name is `services.VECTOR_SEARCH.service` when present, otherwise derived from Core's (`reader-core*` → `reader-vector*`, else `${core}-vector`), so no private configuration change is required.
- `VECTOR_REGION = 'aws:us-east-1'` is defined beside `DATABASE_REGION`; Vector carries it, every other rule is unchanged.
- Generated Vector configuration keeps only `vectorize` filtered to `VECTOR_V5_ARTICLE` (remote in local runs), the compatibility settings and `vars`; `workers_dev`, routes and preview URLs are off.
- AI gets `{ binding: 'VECTOR_SEARCH', service: names.vector }` (default entrypoint, so the fetch honors Vector's placement).
- Release order publishes Vector before AI (callee first) in both normal and bootstrap orders.
- `RUNTIME_KEYS.vector = ['EDGE_SHARED_SECRET', 'JINA_API_KEY']`; `requireValues`, `missingRuntimeValues` and `secrets:sync` include it. A Worker that does not exist yet cannot hold secrets and `secrets:sync` skips it, so the release precondition exempts exactly one case: a single-Worker release (`deploy --target <worker>`) of a Worker that does not exist yet. Every other release, including a full one, still stops on it and names that command. Nothing binds to Vector until the next full release, which the check gates (see Migration).
- Local development (`pnpm api -- dev`) starts Vector on port 8791 with its remote article index; `dev:local` (the isolated smoke launcher) does not change, because it forbids remote resources and the vector call is optional there: AI without a `VECTOR_SEARCH` binding falls back to running the same step in-process.

### D6. Fallback when the binding is absent or fails

`VECTOR_SEARCH` absent (local isolated runs, tests) → AI runs the same function in-process against its own `VECTOR_V5_ARTICLE` binding, so behavior is identical and only latency differs. A non-2xx response, an invalid body, or a call that takes longer than 5 s → the semantic branch fails exactly as today: fulltext results are returned, the failure is logged.

## Risks / Trade-offs

- [The release stops on the new secret] → It is the existing release precondition; the operator runs `secrets:sync` once per account (Migration).
- [The cross-region fetch adds a round trip] → Measured cost of the embedding plus query is 0.29 s in the US against 1.26 s in Singapore; the round trip (~0.2 s) still leaves the branch faster, and it now overlaps candidate preparation and fulltext.
- [The fallback hides a missing binding] → Missing binding is logged once per request with the timing line; deployment always generates it remotely.
- [Fulltext candidates now rely on the five-minute `valid_bm_ids` cache] → Final admission still removes any stale id; the cache is cleared on every bookmark change, as today.

## Migration Plan

1. Before merging, the operator creates the Worker and gives it its values once per account, from this branch: `pnpm api -- deploy --target vector --config <env.toml>` (allowed because the Worker does not exist yet), then `pnpm api -- secrets:sync --config <env.toml> --from <secrets file>`, which uploads `JINA_API_KEY` and `EDGE_SHARED_SECRET` to it. The created Worker serves nothing until AI binds it.
2. Merge. The normal release publishes Vector before AI; AI gains `VECTOR_SEARCH`.
3. Rollback: revert the merge; AI without `VECTOR_SEARCH` uses the in-process path. The Vector Worker can be deleted afterwards.

## Open Questions

- Whether `/v1/search` and recommendations should also move to Vector, decided later from the same tail measurements.
