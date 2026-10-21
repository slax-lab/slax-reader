# Validation

## Environment

- Change: `search-optimize`
- Date: 2026-10-21
- Local workerd D1 through Miniflare 4.20250906.0; Node.js 22.23.1; synthetic libraries.
- No production database, Vectorize index, Jina key, or Cloudflare cron trigger was used.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm api -- typecheck` | Passed |
| `pnpm api -- test` | 179 files passed, 12 skipped; 2,314 tests passed, 71 skipped. An earlier run hit a 10 s timeout in the unrelated bookmark-UID controller test; the isolated test and the re-run passed. |
| `pnpm api -- lint` | 0 errors, 339 pre-existing warnings |
| `pnpm exec openspec validate --all --strict` | 71 passed, 0 failed; `change/search-optimize` valid |
| Local workerd D1 smoke (Miniflare + actual `BookmarkSearchRepo`) | 3 groups / 1 batch / 40 matches in 22 ms; 17-shard write became 17 rows and a replacement left 1 row; 210 KB repeated-token highlight completed in 20 ms |

## Behavior exercised

- Fulltext grouping: 120 rows produced three groups of 50/50/20; 30,010 rows produced 600 groups and stopped at the 30,000-row cap.
- Candidate bounds: 150 ranked items published 100 results; the candidate collector matched a full sort on 2,000 synthetic items.
- Cache: the second identical search returned the cached result and did not call fulltext again; `clearSearchCache` rotated `search:gen` and deleted row/shard maps. Row/shard map TTLs remain 300 s because a shared bookmark can be re-indexed by another owner without clearing this user's cache.
- Result-cache key/TTL: written as `search:res:v1:<userId>:<generation>:<hash>` with `expirationTtl: 300`; writes are skipped when any retrieval stage rejects or a fulltext batch reports incomplete.
- Segmentation cache writes use `execution.waitUntil` and are skipped when any term falls back after a timeout or empty segmentation.
- Raw writes: 17 shards produced one DELETE plus two INSERT statements (96 and 6 bound parameters) in one D1 batch; replacing the bookmark left one row.
- Highlight: existing security/output cases and 3,000 randomized inputs matched byte-for-byte; the large-text regression stayed below the 2 s test budget.
- Embedding cache/timeout: a repeated query used one provider call, and an aborted provider returned no new embedding.
- Vector timeout: a never-resolving vector query was dropped after 500 ms.
- FTS optimize command: executed against Miniflare D1 in a standalone measurement (data blocks 1,515,630 to 1,176,877 bytes; query median 338 ms to 317 ms).

## Not verified

- Production D1, Hyperdrive, Jina, and Vectorize latency. Local workerd/Node timings do not include production network or provider load.
- The real `17 3 * * *` cron trigger. The command itself was executed on Miniflare, but the scheduler path was not fired. Operators must add `17 3 * * *` to their private API configuration; `deploy/cloudflare/api.toml.example` carries it.
- A browser hands-on search session. No web/extension UI files changed; the new 100-result response cap is an API behavior change requested by the human on 2026-10-21, and it is the only user-visible change in this diff.
- Production `optimize` duration on a large FTS index. D1 enforces a 30 s query limit; a failure is logged by `SearchJob` and does not affect requests.

## Human acceptance

The human requested the exact bounds and cache TTLs and asked for this change to be implemented and submitted as `feat/search-optimize`. No separate hands-on UI acceptance was performed; the result cap must be reviewed as an API behavior change.
