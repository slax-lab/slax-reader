# Validation

## Measurements behind the change (2026-11-24, test account)

- `/v1/bookmark/search` from the client: 3.7–5.2 s for six fresh keywords. `wrangler tail`: Edge wall time 3.2–4.7 s, AI 3.0–4.5 s (SIN), of which the V5 semantic branch 2.0–3.3 s, candidate preparation 0.45–0.86 s and fulltext 0.1–0.55 s.
- Two temporary probe Workers (`aws:ap-southeast-1` and `aws:us-east-1`, deleted after the run, 12 fresh keywords each): Jina embedding median 278 ms vs 81 ms; Vectorize topK 50 with values 978 ms vs 213 ms; embedding plus query 1.26 s vs 0.29 s. Jina's `cf-ray` was `-SIN` and `-IAD` respectively.
- Cloudflare documents that placement applies only to `fetch` handlers and not to RPC methods or named entrypoints, so AI calls Vector with a `fetch` (as Edge already does for Core's `jobs.internal`).

## Automated checks (branch `perf/us-vector-search-worker`)

- `pnpm api -- test`: 286 files passed, 20 skipped; 4,561 tests passed, 166 skipped (existing skips).
- `pnpm api -- test test/script/layerArchitecture.test.ts`: 45 passed. `pnpm api -- typecheck`: passed. `openspec validate --all --strict`: 175 passed.
- `test/script/workerTopology.test.ts` builds every Worker: Vector's bundle is 44.8 KiB (19.6 KiB gzip) with no WebAssembly, registry, router, Prisma, Workflow or Durable Object module, and `RUNTIME_KEYS.vector` equals the strings its bundle reads (`EDGE_SHARED_SECRET`, `JINA_API_KEY`).
- `test/entry/vectorSearch.test.ts`: the entry embeds once and makes one article query with values; 403 without the secret, 404 for another host, path or method, 400 for an invalid body, 500 without the provider message; AI's client sends the secret to `vector.internal/search`, rejects error statuses and malformed answers, and is unavailable without the binding.
- `test/domain/searchHighlightSecurity.test.ts`: the semantic step starts before candidate preparation; an untagged search makes only the admission query; a trashed best candidate sets neither the floor nor the relative bound (fails without the admission filter); below the floor a hybrid hit keeps its fulltext match; a failed Vector call returns the fulltext results; the binding path and the in-process path return the same shape.
- `release.test.ts`: a Worker that does not exist yet blocks a full release and a release of another Worker, with the `deploy --target vector` command in the message, while `deploy --target vector` itself may create it and still checks the other Workers.
- `test/script/deployPaths.test.ts`, `release.test.ts`, `syncSecrets.test.ts`, `rootDeployment.test.ts`, `devPortGuard.test.ts`: Vector's name, `aws:us-east-1` placement, article-only binding, no route, AI's default-entrypoint `VECTOR_SEARCH` binding, publication before AI in normal and bootstrap orders, the release stop while Vector lacks its values, and `secrets:sync` uploading them.

## Not verified yet

- A running environment. The Vector Worker does not exist on any account until the operator runs `pnpm api -- deploy --target vector` and `pnpm api -- secrets:sync` (design.md, Migration Plan); then the merge publishes it. The service-binding round trip from AI (SIN) to Vector (US) and the end-to-end latency are measured on the test account after that (tasks 4.4).
