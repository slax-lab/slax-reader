# Validation

## Scope and approval

The user approved skipping oversized individual images and delivering a PR on 2026-11-11. A conditional WeChat WebP exception was investigated: both failing images use `mmbiz.qpic.cn` source URLs already carrying `tp=webp&wxfrom=5`, but stored MIME types remain PNG and GIF. No missing-parameter exception applies; no image refetch, conversion, storage rewrite, or deployment was performed. No CLI, Extension, or Mobile code, package output, contracts, or dependencies change, so their package-version decision is not applicable.

## Running-environment evidence

On 2026-11-11, reproduced the original failures using actual test PostgreSQL source rows, saved HTML/Markdown, real R2 image bytes and metadata, the deployed public image-proxy prefix, and the actual article input builder. Eight original image requests yielded six successes and two HTTP 422 responses:

- PNG: 8,622,081 raw bytes; provider reports maximum 5,242,880 bytes; request ID `ebd0c16073a1638ce64600d10391d3ef`.
- GIF: 7,083,321 raw bytes; same provider maximum; request ID `6a2b0ad99992b0bff3ecb39af29fa322`.

The earlier text-only replay was not a full-input reproduction and is not used as evidence of identical complete requests.

Replayed both sources with this branch's actual `VectorSourceRepo`, `VectorEmbeddingClient`, and `ArticleVectorAccumulator`, using a read-only TLS database connection, remote R2 reads, and the previously authorized temporary Jina credential held only in process memory. Requests were serial with ten seconds between them. No remote vector index writes occurred.

- Sample 1: one oversized image skipped at metadata without downloading its body; text and three eligible images retained. All four real provider calls succeeded.
- Sample 2: one oversized image skipped at metadata without downloading its body; text and four eligible images retained, including a later image that now fits the selection allowance. All five real provider calls succeeded.
- Both locally accumulated representative vectors have 1,024 finite dimensions and unit norms within floating-point tolerance.
- Read-only inspection confirms both rejected images already have WebP selection parameters; adding those parameters again would not address the stored oversized objects.
- Diagnostic records retain counts, sizes, formats, flags, hashes, and provider request IDs only; no article text, full source URL, image bytes, API key, or user identity is included in this PR.

## Automated checks

- `pnpm api -- test test/utils/vectorSources.test.ts`: 16 tests passed. Coverage includes limit-plus-one rejection at metadata and retrieved-byte checks, exact-limit and limit-minus-one acceptance, preserved text/four eligible-image slots, oversized-only no-content failure, and the independent request-byte budget.
- `pnpm api -- gen:all`: passed using `SLAX_API_SKIP_DOTENV=1`, the public `deploy/cloudflare/api.toml.example` template, disabled Wrangler dotenv/metrics, and loopback placeholder database URLs for client generation only. No tracked generated output changed.
- `pnpm api -- typecheck`: passed.
- Prettier check of both changed source files and the changed test file: passed after formatting the test.
- `git diff --check`: passed.
- `pnpm exec openspec validate --all --strict`: 134 passed, zero failed.
- `pnpm api -- test`: 249 files passed, 15 skipped; 3,924 tests passed, 142 skipped, zero failures. The first invocation incorrectly inherited the generation-only `SLAX_API_CONFIG` override and failed nine setup-fixture tests. The successful full rerun used `env -u SLAX_API_CONFIG -u HYPERDRIVE_DATABASE_URL -u LOGS_DATABASE_URL SLAX_API_SKIP_DOTENV=1 CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false WRANGLER_SEND_METRICS=false pnpm api -- test`; no unrelated test was modified or disabled.
- `pnpm api -- lint`: passed with zero errors and 343 warnings.
- `SLAX_API_SKIP_DOTENV=1 SLAX_API_CONFIG=deploy/cloudflare/api.toml.example CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false WRANGLER_SEND_METRICS=false pnpm api -- build`: all four Worker bundles passed using Wrangler `--dry-run`; nothing was deployed.

## Gaps and boundaries

- No deployed Worker was changed. Remote refresh endpoints, Workflow completion, and eventual Vectorize persistence were not re-exercised with this patch because deployment and remote vector writes are outside the authorized PR-only scope.
- The two affected sources were exercised through real local input construction, real provider embedding, and local representative accumulation; this is not a claim that the remote failure ledger has already been repaired.
- Exactly-5-MiB acceptance and inaccurate metadata are covered by deterministic regression tests, not synthetic provider uploads.
- The optional full HTTP/database setup smoke was not run; the changed surface is stored-image selection and has direct real-source/provider coverage. No UI presentation changes require hands-on visual acceptance.

## Local review

Completed the three `REVIEW.md` passes against this branch's source/test diff and `skip-oversized-vector-images` artifacts on 2026-11-11. No Important findings.

- Bugs: strict `>` preserves exactly-at-limit images; metadata rejection avoids downloading large objects; the retrieved-byte check precedes base64 encoding; both skips leave text and later image selection intact; the independent request budget and no-content failure remain. Existing comments still match the code.
- Security: no new dependency, secret, network destination, log payload, source write, migration, or remote image refetch. Diagnostic credentials and source data are not committed.
- Compliance: the implementation matches the approved raw-size filter, the conditional WebP investigation is recorded, tests cover the six delta scenarios, running-source evidence is recorded with deployment gaps, and the PR targets `dev` without merging or deploying.
