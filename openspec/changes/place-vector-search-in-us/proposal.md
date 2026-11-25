# Proposal

## Why

`/v1/bookmark/search` takes 3–5 s in the test environment, and its V5 semantic branch alone takes 2.0–3.3 s. The AI Worker is pinned to `aws:ap-southeast-1` beside PostgreSQL, but the query encoder (Jina) and the V5 Vectorize index answer from North America, so each semantic step crosses the Pacific. Temporary probe Workers on the test account (2026-11-24, 12 fresh keywords each) measured:

| Step | `aws:ap-southeast-1` (median) | `aws:us-east-1` (median) |
|---|---|---|
| Jina query embedding | 278 ms | 81 ms |
| Vectorize topK 1 | 255 ms | 68 ms |
| Vectorize topK 50 without values | 252 ms | 58 ms |
| Vectorize topK 50 with values | 978 ms | 213 ms |
| Embedding + query with values | about 1.26 s | about 0.29 s |

Moving the whole AI Worker to the US would turn every PostgreSQL, fulltext D1, KV and tokenizer call into a cross-ocean round trip, and Smart Placement does not measure binding traffic. The semantic step is the only part that wants the US.

## What Changes

- **A sixth API Worker, Vector**, pinned to `aws:us-east-1`. It binds only the V5 article index and reads only `JINA_API_KEY` and `EDGE_SHARED_SECRET`. It serves one internal request over its service binding: a single `fetch` that embeds the keyword, queries the caller's article vectors with their stored values (topK 50), rescores them by mean-centered cosine and returns the scored candidates. The call is a `fetch`, not RPC, because Cloudflare applies placement only to `fetch` handlers; an RPC method would run beside the caller. It has no router, registry, database, KV or Durable Object, and it accepts only requests carrying the edge shared secret.
- **AI calls Vector concurrently.** For an untagged `/v1/bookmark/search`, AI starts the Vector call as soon as the request arrives and runs candidate preparation, tokenization and fulltext ranking beside it. The ownership filter, the 0.35 floor and the 0.6 relative bound are applied after candidates are admitted against PostgreSQL, so results do not depend on which step finishes first.
- **The untagged search no longer waits for an up-front PostgreSQL list.** The final admission query already revalidates ownership and trash state; the up-front list stays only for tag-filtered searches, which keep the legacy encoder and buckets.
- **Deployment**: the deployment script derives the Vector Worker's name from Core's (`reader-core` → `reader-vector`, `reader-core-beta` → `reader-vector-beta`) unless `services.VECTOR_SEARCH.service` names it, publishes it before AI, gives AI the `VECTOR_SEARCH` service binding, and checks that it holds `JINA_API_KEY` and `EDGE_SHARED_SECRET` like every other Worker's runtime values.
- **BREAKING (operators)**: before the first release with this change, `pnpm api -- secrets:sync` must give the new Worker `JINA_API_KEY` and `EDGE_SHARED_SECRET`; otherwise the release stops before publishing, as it does for any Worker that lacks a value its code reads. No other configuration changes.

Out of scope: `/v1/search`, recommendation and vector maintenance stay in AI (they also read Vectorize and may move later with measurements); tag-filtered searches; changes to scoring, thresholds or the response shape.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `api-worker-topology`: a sixth Worker with a fixed responsibility, bundle and location; AI gains the binding to it.
- `vector-v5-runtime`: the untagged `/v1/bookmark/search` semantic branch is served by the Vector Worker in one call and runs concurrently with the rest of the search; Vector owns its native article index binding.

`api-worker-topology` is added by the unarchived change `split-api-worker-tiers`, and `vector-v5-runtime` is also modified by the unarchived `optimize-bookmark-fulltext-query`. This change is archived after both, and its deltas apply to the requirements they leave.

## Impact

- API: new entry `src/entry/vector/index.ts`; `SearchService.hybridSearch` and `semanticSearchV5`; a client for the binding; deploy scripts (`config.ts`, `deploy.ts`, `runtimeKeys.ts`, `topology.ts`, `sync-secrets.ts`, `wrangler.ts`, `generate-worker-types.ts`; `build.ts` follows `TARGETS` and `dev:local` is unchanged) and their tests; `worker-configuration.d.ts`; deployment documentation.
- Cloudflare: one new Worker per account (test, beta, production); no new index, database or route. Service-binding calls are billed as CPU time only.
- No HTTP contract change. Untagged search results are unchanged; latency changes.
