# Design

## Context

See `proposal.md` for current authorization and exclusions. This design replaces the unshipped shared-canonical, recipe/manifest/ledger and source/daily platform. The working root is `/Users/daguang/project/slax-reader`; the recovery copy in `vector-sync` must not be imported wholesale. Historical validation and snapshot manifests do not establish correctness of this replacement.

The existing business tables, R2 source objects, Core/Edge/AI split, personal search route and owner-based Collections remain authoritative. No PostgreSQL schema or relationship changes are required.

## Goals / Non-Goals

**Goals:** Per-user article vector isolation; complete eligible history; three fixed indexes; one reusable maintenance service; native metadata filters; existing Collection publication rules; independent user preference targets; truthful failure and refresh reporting.

**Non-Goals:** Shared canonical article vectors, refcounts, user-ID arrays, global DISTINCT bookmark enumeration, new PostgreSQL tables/fields/migrations/triggers, vector accumulators in SQL, run/item queues, recipe/digest/shard/frozen configuration, DO locks or leases, concurrency coordination services, source ingestion, Bot, daily editions, UI, private configuration changes or automatic cloud provisioning.

## Decisions

### 1. Minimal service and native ownership

`utils/vectorMaintenanceTypes.ts` is the shared contract. The normal application DI registry owns server connections and resource lifecycle. Repositories own SQL and authoritative data reads; Services own article refresh/read, Collection aggregation/query, exact-user preferences, embedding and native mutations. Controllers own HTTP authentication/validation and safe response mapping, not connection construction or SQL. Workflows initialize and dispose the standard context/container and resolve the same Service, not a manually wired `openVectorMaintenance(env)` graph. Consumer Services reuse that dependency graph rather than reconstructing embedding or aggregation algorithms. Recommendation HTTP handlers delegate validated inputs to the project's existing-style `ContentRecommendationOrchestrator` in `domain/orchestrator/`: that layer coordinates the ranking Service, impression/algorithm metadata and the existing event-submission helpers. The Controller retains authentication and request parsing, HTTP errors/envelopes and cache headers only; it does not construct recommendation analytics records or dispatch them itself. The refactor does not alter routes, response fields, event delivery semantics, ranking formulas, query parallelism or storage.

The latest human correction keeps the four single-target refresh actions in existing Controllers and changes only their auth entry boundary. Add the four existing paths to the existing whitelist without changing its predicate, JWT/API-key/rate handling, trusted-Edge identity behavior or forwarding modes. Edge uses existing anonymous forwarding and preserves X-Vector-Refresh-Secret; it does not validate that secret. Each Controller calls the shared `utils/vectorRefreshAuth.ts` utility first, before canonical-path checks, body parsing and service work. VECTOR_REFRESH_SECRET is configured only in Core and the caller. Any normal login that passes existing middleware still cannot replace the Controller secret. There is no task Bearer compatibility, middleware task branch, generic dispatcher or internalRoutes addition. `vector-bulk-sync` alone owns the precise route/body/auth requirements. Its requests call the shared Service for one target, never the cascading Workflow; article, preference and Collection refreshes do not refresh dependent logical targets.

The standalone operator can create one existing `pg.Client`, set a read-only session and close it in `finally`. It enumerates private article pairs, active users once per preference kind and Collection IDs, then calls the task endpoints sequentially with the fixed secret from its environment. The separate bulk design owns bounded pages, explicit scope and single-kind manual cursors without target batches, checkpoints, receipt polling or automatic recovery. A single target can require paged source reads but never silently triggers another logical target.

`AiEntry` is only an RPC boundary. Native binding selection, validation, normalization, query filters and mutations live in `infra/repository/vectorIndexRepo.ts`. New RPC names are `getVectorsByIds`, `upsertVectors`, `deleteVectorsByIds` and `queryVectors`; Core/Edge `VectorIndexClient` remains a remote adapter and depends on the Repository-side RPC contract rather than the Entry class. Legacy `query`, `upsert` and `deleteByIds` signatures are preserved for serving search and also delegate into the native Repository. There are no compatibility aliases for the unshipped `v5*` RPC names, no self-RPC and no second DI service graph.

AI owns native Vectorize bindings; Core and Edge use the existing VECTOR RPC adapter. Local AI bindings retain remote:true. The maintenance Workflow uses standard DI and named processing steps, not a content-to-article-to-owner-to-Collection-to-user relay of child Workflows. Article processing writes and verifies that user's article, updates their own article preference, then refreshes their owned Collection representations independently. Collection publication processing retains existing member maintenance and its independent Collection representation, then stops; it does not emit article/chunk recommendable markers or admit members to an article feed. Neither article nor Collection targets enumerate subscribers or refresh their preferences, even when the Collection vector changes. This replaces the earlier automatic subscriber fanout at the human's explicit direction. Subscription/cancellation/expiry actions update only the affected user's Collection preference; existing explicit refresh and the bulk subscription stage remain available. Account-deletion cleanup keeps its separately scoped subscriber cleanup responsibility. A user's Collection preference is consequently a snapshot from its last user-triggered or explicit refresh, not a cache automatically kept current by every Collection content change. No new scheduler, lazy-refresh mechanism, flag or coordinator is added.

New capture/import work admits maintenance through an explicit step in the existing processing/post-processing flow after original content is committed. Base relation persistence and SearchService semantic normalization do not dispatch new-bookmark maintenance. Existing-content recovery enters the same post-processing responsibility without re-fetching originals. Read ordinary api.toml bindings through readConfig; no extra overlay or feature flag is required. JINA_API_KEY remains the provider secret; VECTOR_REFRESH_SECRET is separately configured for the human-approved task endpoints. Neither secret is generated, printed or installed in production by this implementation task.

### 2. User-private article identity

The article index uses the default namespace. Its representative ID is `a:<userId>:<bookmarkId>` and chunk IDs are `a:<userId>:<bookmarkId>:c:<n>`. Both identity components are positive numeric IDs from current authoritative relations. No per-user namespace is created.

Historical enumeration starts from `sr_user_bookmark` and retains every eligible `(user_id, bookmark_id)` pair. If A and B saved the same underlying bookmark, refresh writes two independent representatives and their chunks. Deleting A's save removes only A's prefix and does not affect B. Existing shared database records or R2 originals are reused read-only; vector privacy does not require duplicating business rows or source bytes. A URL or global bookmark ID must not collapse separate owners.

Use deterministic IDs and representative `part_count` metadata to determine the previously written chunk range on replacement/deletion. Current eligibility is rechecked before publication and on retries. Sequential refresh is idempotent by replacement, not applied-contribution arithmetic. Do not add locks or a ledger to make unproven cross-run ordering claims: concurrent mutation/refresh behavior requires explicit testing and remains a release gap if not demonstrated.

### 3. Metadata contract and indexes

Metadata supports authorization prefilters and bounded retrieval; it is never the final publication authority. Types below are the intended contract, not evidence that a remote metadata index was created. Create indexes only for actual native filters; fields used only for readback/cleanup do not need indexes.

| Index | Field | Type | Purpose | Metadata index |
| --- | --- | --- | --- | --- |
| Article | `user_id` | number | Mandatory private vector-query owner equality filter | Yes |
| Article | `kind` | string | Select representative/chunk record kind | Yes |
| Article | `bookmark_id` | number | Identity/readback; no natural-query search cutover is authorized | No new index in this revision |
| Article | `recommendable` | Removed from writes | No article publication or feed-admission role | Existing physical index may remain unused; no production cleanup |
| Article | `published_at` | number | Readback; article-feed ranking is paused | No active native filter |
| Article | `part_count` | number | Representative readback and exact stale-chunk cleanup | No |
| Collection | `recommendable` | boolean | Existing published/readable Collection filter, unchanged | Yes |
| Collection | `published_at` | number | Readback only | No native filter in this release |
| Collection | `owner_id` | number | Identity/readback; current owner exclusions use authoritative SQL | No until a native owner filter is used |
| User | identity/preference metadata, when emitted | typed scalar | Exact-ID readback validation only | No |

Any additional Collection identity or diagnostic metadata is return-only unless a concrete filter is added. Do not create indexes for every emitted metadata field. Article `user_id` is one number, never an array/string or a global ownership surrogate. This correction performs no remote index/configuration changes or cleanup; past provisioning evidence is historical, not an instruction to remove an unused article metadata index.

Private native article-vector queries retain numeric `user_id` equality and representative kind before top-K. The latest approved POST /v1/search derives that owner from normal authentication and performs current-state admission, as section 7 specifies. Its first contract accepts no tag filter. Existing /v1/bookmark/search still uses jina-clip-v2 and legacy buckets with its unchanged all-tags behavior; no old-route cutover is authorized. Tasks 4.2/4.3 and the new streaming acceptance tasks remain unchecked until real implementation/runtime evidence exists; native vector methods alone do not close them.

Article representatives and chunks do not emit or use `recommendable`. Published/starred/readable Collection membership no longer automatically admits their articles to a public feed, and stale marker metadata is not an admission authority. Until an operator-supplied public article pool exists under a separately established contract, the article feed returns `no_public_candidates` without ANN, latest/popular candidate queries, candidate hydration or model calls. No pool endpoint or script is added. Collection visibility, eligible member aggregation and Collection recommendation retain their existing rules.

### 4. Content and aggregation

One foundation implementation owns the embedding task, dimensions, normalization and input preparation. It uses the agreed Jina v5 representation consistently for writes and matching queries; switching only the query encoder is invalid. Fit the complete title/body text input first and split text only for actual model/request bounds. Do not treat R2 transfer pages as embedding chunks or silently truncate history/content. Preserve substantive image/text processing where required; PDF coverage follows the approved size-based policy below. Existing content is reused, not staged in a new vector database/platform.

The human-approved PDF revision of 2026-11-04 uses original PDF byte size, not the encoded request size: at `<= 8_000_000` bytes, send the original directly to Jina as one PDF input in one request. Above `8_000_000` bytes, use the text already extracted by the preceding pipeline through the existing text-embedding path. Determine the branch from existing source-size metadata before any original-body read; the larger-PDF branch must not fetch or read that original body for vector maintenance. The existing 50 MiB source-upload limit and acceptance remain unchanged: larger accepted PDFs use text fallback, not full-visual PDF submission. No PDF page splitting, temporary R2 objects/files, re-OCR or new parser is introduced.

Missing or empty preceding-pipeline text for a larger PDF reports explicit incomplete coverage or failure, never successful empty output. Provider, embedding and mutation failures remain failures; the approved text-only representation for larger PDFs must not claim full visual modalities. This policy supersedes earlier planned full-visual 50 MiB or page-splitting requirements without weakening per-user identity, privacy, stale-chunk cleanup, publication checks or human release gates.

The reaffirmed `pdf-lib` removal eliminates local PDF loading and page-count prediction from vector maintenance. Input preparation performs existing byte-budget checks and unchanged base64 encoding only; the upstream extraction and metadata-repair pipeline is unchanged. PDF success responses use the native JSON reader under the existing provider deadline instead of a response-byte ceiling derived from predicted page count. Validate the exact model, a nonempty embedding array, unique contiguous indices covering `0..data.length-1`, and finite nonzero 1024-dimensional vectors; then derive `part_count` from validated results. Text/image batches retain their expected input count and current response-byte bounds, and error bodies remain bounded. Empty, malformed or interrupted responses fail explicitly. No PDF parser replacement, guessed pages-per-byte, fixed page count, streaming parser framework, or additional library is introduced. Native JSON parsing still materializes the provider response in memory; removal of PDF parsing does not prove an unlimited response-memory budget or independently verify that the provider returned every source page.

Collections continue to use their existing owner and eligible member rules, with each owner's article representative counted once regardless of chunk/image/page count. No source Collection identity is introduced. Recompute aggregates from current membership instead of retaining SQL raw sums or immutable contribution rows.

User article preference derives from all current eligible user saves, each weighted by its engagement actions as defined in section 6.1: one for the save and one more for a current star. Weights are counted, not chosen. The same record carries the PinnerSage interest clusters of section 6. Archive alone is neutral.

### 5. Maintenance and consumer boundary

Existing capture/import/Fork/recovery and business mutation hooks dispatch minimal target work after committed source changes. Heavy embedding and history recomputation runs in the native maintenance Workflow or the bounded bulk service, not inline in unrelated HTTP mutations. Refresh current data when replaying; remove deleted user/save vectors without restoring stale caller state. No trigger/cron/outbox platform is introduced to promise exactly-once or globally serial processing. Dispatch failure must be visible and repairable through explicit refresh; do not claim durable recovery when no persisted intent exists.

The Collection recommendation consumer uses the same service and existing Collection publication/read admission, returning its bounded ranked results. The article consumer instead returns `no_public_candidates` until a separately supplied public pool exists, without ANN, latest/popular queries, candidate hydration or model calls. This pause does not alter private `(userId, bookmarkId)` storage, user preference maintenance or Collection aggregates. It introduces no pool endpoint/script and does not expose private saves through presentation deduplication.

### 6. Recommendation algorithms: paused article design and retained Collection behavior

Current-revision boundary: article retrieval and request-time ranking in 6.1, 6.2, the article portions of 6.3/6.5/6.6, and their historical public-member assumptions are paused provenance only. None is an active feed requirement or permission to infer a pool from Collection membership. The latest empty-feed rule in sections 3 and 5 controls until an operator-supplied pool and its separate admission contract exist. Existing preference action weighting, clustering and raw/centered materialization remain; Collection ranking in 6.4 and feedback recording in 6.7 are unchanged.

Historical algorithm approval on 2026-11-05 is retained below, not reactivated: each stage used a published algorithm, published/derived/calibrated values and the recorded platform bounds rather than extra score terms. These formulas and measurements remain useful provenance, but this revision does not execute article candidate retrieval/ranking or authorize a production replay.

#### 6.1 Article ranking: ZoRRO

Source: Kruse et al., "ZoRRO: A Zero-Weight Personalized Recommender System for Scalable News Recommendation", SIGIR '26, arXiv:2607.10910, and the authors' `src/zorro/model/zorro_numpy.py`.

`r(c) = φc(c) · Σ_{h∈H} τ(c,h) · φh(h)`, with `φc(c) = e^(−λc·t(c))`, `φh(h) = e^(−λh·t(h))`, `t` in hours since publication and `τ(c,h) = cos(e_c, e_h) + CategoryMatch(c,h)`.

- `λc = 0.015` per hour and `λh = 0`: the paper's best setting and the implementation defaults (`decay_factor_cand`, `decay_factor_hist`). They were selected on EB-NeRD news. Slax has no interaction log to repeat the grid search yet; a 30-day-old candidate keeps about `2·10⁻⁵` of a new one's weight, so ranking strongly prefers recent publications. Later recalibration repeats the paper's λ grid search on Slax interactions and does not change the formula.
- `CategoryMatch` is omitted. Slax has no shared article taxonomy; tags are private per user. This is the paper's embedding-only configuration (`use_cat=False`, Table 5 ablation), not a substitute signal.
- `H` is the user's current eligible engagement actions with `λh = 0`. ZoRRO's history is a sequence of engagements; Slax records two engagement kinds, a save and a star. A saved identity contributes one action, plus one more while it is starred, so a starred save appears twice in `H`, as PinnerSage's action sequence lists a pin once per repin or click. This follows Hu, Koren and Volinsky's implicit-feedback principle (ICDM '08) that more observed positive actions mean higher confidence; the factor 2 is a count, not a tuned weight. Unstar removes the second action; archive changes nothing. Representatives are unit vectors, so `Σ_{h∈H} cos(e_c, e_h) = e_c · S` with `S = Σ_i n_i·e_i` over distinct saved identities `i` with action count `n_i`, and `Ŝ = S/|S|`. The stored article preference is `Ŝ`; within one request `|S|` is a positive constant, so ranking by `φc(c) · cos(e_c, Ŝ)` is identical to ranking by `r(c)`. Computation uses `log φc = −λc·t`, which does not change order and avoids underflow for old articles.
- `t(c)` is `now − sr_bookmark.published_at` in hours from the authoritative hydration row; a negative value (future date or clock skew) is treated as 0.
- Ties order by `(user_id, id)` ascending. An empty history is cold start, as the authors' implementation returns an empty ranking for an empty history.

#### 6.2 Candidate generation

ZoRRO scores a supplied candidate set and does not define retrieval. The candidate set is the union of the four sources named by the approved research (semantic recall, latest, popular) plus PinnerSage multi-interest retrieval, deduplicated by `(user_id, id)`.

**Interest channel: PinnerSage.** Source: Pal et al., "PinnerSage: Multi-Modal User Embedding Framework for Recommendations at Pinterest", KDD '20, arXiv:2007.03634, section 3.1 and Algorithm 1. Embeddings are fixed, as the paper assumes.

- Actions `A` are the engagement actions of 6.1 within the last 90 days (paper: "last 90 days"): a save at `sr_user_bookmark.created_at` and a star at `starred_at` (falling back to `created_at`), each on a current eligible saved identity. Clustering runs over the distinct articles of `A` with their representatives `P_a`; a cluster's importance sums over all actions on its articles, so a starred article adds two decay terms. A duplicated vector therefore cannot form an artificial cluster of itself.
- Clustering is Ward agglomerative clustering exactly as Algorithm 1: initial `d_ij = ||P_i − P_j||²`, the Lance-Williams update `d(Ci∪Cj, Ck) = ((ni+nk)·dik + (nj+nk)·djk − nk·dij) / (ni+nj+nk)`, nearest-neighbor-chain merging, then cluster selection by walking the merge history in decreasing `d_ij` and keeping `Ci∪Cj` when `d_ij ≤ α` and it is disjoint from every kept cluster. Actions never merged within `α` belong to no cluster, as in Algorithm 1. Ward merge heights never decrease, so this cut equals cutting the dendrogram at height `α`.
- `α` is not published; PinnerSage treats it as an input. The first value, `α = 0.4`, came from the paper's relevance threshold (`cos ≥ 0.8` gives `2(1 − 0.8)`). Measured on cached public data (task 4.8) it left 89.8% of history unclustered and 25 of 60 users without a cluster, and medoid retrieval underperformed the single profile at equal budget. `α` is therefore calibrated with the paper's own retrieval protocol (section 5.3.1): a predefined grid over the observed Ward merge heights, a selection rule fixed before running, and the winning value recorded in `validation.md`. Mojena's upper-tail stopping rule (cut at mean + k·sd of fusion levels) is reported as a reference, not substituted. Adopted 2026-11-05: `α = 0.6688538990`, the 40th percentile of observed merge heights and the pre-registered winner (pooled recall 28/189 of the medoid channel); neighbouring grid values 0.71-0.78 are one target behind, so the evidence supports a plateau, not an exact optimum. Recalibrate on Slax replay data when authorized. With centering (6.6) the production cut uses centered representatives and `α_c`; this raw value is superseded.
- Medoid: `argmin_{m∈C} Σ_{j∈C} ||P_m − P_j||²`. For unit vectors this is the member with the largest `P_m · Σ_{j∈C} P_j`, the same minimizer. Scores within a relative `1e-9` count as equal and the smaller bookmark ID wins; every two-member cluster is such a tie.
- Importance: `Importance(C, λ) = Σ_{i∈C} e^(−λ·(T_now − T[i]))` with `λ = 0.01` and time in days, the paper's chosen value. A common factor `e^(−λ·Δ)` between refresh and serving cancels in sampling proportions, so stored importance stays valid.
- Serving samples at most 3 medoids proportionally to importance, without replacement (paper section 4). Sampling uses the Efraimidis-Spirakis key `u^(1/w)` with `u` taken from SHA-256 of `<userId>:<UTC date>:<medoid bookmarkId>`, so a user's sample is reproducible within a day and changes daily. Each sampled medoid's own article representative queries the public article index for its nearest neighbours. The paper retrieves `⌊400/e⌋` per embedding; for `e ≤ 3` that exceeds the native top-K limit, so each query uses the limit (100). A sampled medoid whose representative no longer exists is skipped.
- No cluster (no recent actions, or none merged within `α`) leaves this channel empty.

**Profile channel.** Native ANN with `Ŝ` against the public article index, kind `article`, top-K 100. It retrieves the candidates with the highest `cos(e_c, Ŝ)`, the relevance factor of 6.1.

**Latest channel.** The 100 most recently published eligible public members by `sr_bookmark.published_at`, read through the authoritative SQL eligibility rules.

**Popular channel.** Eligible public members published within `W` hours, ordered by popularity and then publication time, limit 100. Popularity is the number of distinct users with a current non-deleted save of the same `target_url`; the count is a candidate-selection signal only, never displayed, and is not part of the ZoRRO score. `W = ln(100)/λc ≈ 307` hours is the publication age at which `φc` falls to 1% of a new article's weight; older articles cannot rank on recency anyway.

All four channels exclude the viewer's own saves and already-saved originals through the same hydration rules. One authoritative hydration call admits the union; representatives of admitted candidates are read in native batches of 20 with bounded concurrency. A candidate without a readable representative cannot be scored and is dropped.

#### 6.3 Diversification: MMR

Source: Carbonell and Goldstein, "The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries", SIGIR '98.

`MMR = argmax_{D_i ∈ R\S} [ λ·Sim1(D_i, Q) − (1−λ)·max_{D_j ∈ S} Sim2(D_i, D_j) ]`, selected greedily until the requested limit.

- `R` is the ranked list from the ranker cut at the paper's threshold `θ` expressed as a document count: the 50 best-scored candidates. 50 is the endpoint's maximum `limit`; the endpoint returns one list and has no further pages.
- `Q` is the user profile (the paper allows "a query or user profile"). `Sim1` is the ZoRRO relevance rescaled so the best candidate is 1: `Sim1(c) = cos(e_c, Ŝ) · e^(log φc(c) − M)`, where `M` is the largest `log φc + log cos` over candidates with positive cosine (or the largest `log φc` when none is positive). This preserves ZoRRO's order exactly. Positive candidates lie in (0, 1]; a non-positive candidate is ≤ 0 and ranks after every positive one. Without rescaling, `e^(−λc·t)` underflows to 0 for old candidates and MMR would rank on redundancy alone.
- `Sim2` is cosine between article representatives, unclamped as in the paper's formula.
- `λ = 0.7`: the paper's larger evaluated setting (Table 1 compares `λ = 1, 0.7, 0.3`), which section 2 recommends for focusing on the most relevant documents. A personalized feed is the focusing case, not information-space exploration (`λ = 0.3`).

#### 6.4 Collection ranking

- Representation: the normalized mean of the Collection's current eligible member representatives, the item-view bundle representation of CrossCBR (Ma et al., SIGIR '22, arXiv:2206.00242, Eq. 5). Section 4 already defines this aggregate.
- Relevance: `cos(e_C, user-collection preference)`. Candidates come from native ANN top-K 100 against the Collection index and pass one authoritative eligibility hydration; scores use exact cosine of the read Collection vectors. No recency term: ZoRRO's decay is defined for articles, and adding one to bundles would be an unpublished extension.
- Diversification: MMR as 6.3 with `Sim1 = Sim2 = cosine` and `λ = 0.7`.
- Recent members (up to 3 by star time) are a display preview only. They do not change score or order, and their per-item scores are not returned.

#### 6.5 Platform bounds and declared limitations

- Native query top-K is at most 100; native by-ID reads take at most 20 IDs per call (observed in the authorized test binding).
- Ward clustering costs O(m²) memory and time. Clustering uses at most the 2,000 most recent actions inside the 90-day window, and the distinct articles they reference, so a refresh fits the Worker's 128 MB isolate and 30 s CPU limit. A user over the bound is clustered on their most recent 2,000 actions; the paper runs on a batch cluster and states no bound.
- At most 100 clusters, ordered by importance, are stored to fit the 10 KiB metadata limit; the paper reports 75-100 clusters for heavy users. Storage is the `interests` metadata string of the `user-article` record: JSON `[[medoidBookmarkId, importance], ...]`, importance rounded to 6 significant digits. Write verification covers it.
- Clusters are recomputed at every article-preference refresh (save, delete, restore, Fork, import and recovery events), not by the paper's daily batch. A user without new events keeps the clusters of their last refresh; no scheduler is added.
- `λc` and `α` are defaults or derivations until Slax interaction data allows the papers' own calibration procedures. A feed with no recent publications is ordered almost entirely by publication time; this follows from the published `λc`.
- Popularity aggregates private saves into a count. It is never returned, but the deferred Security review must classify it before shipping.
- The latest and popular channels order the eligible public pool by `published_at` without a dedicated index. Acceptable at current scale; reassess before production growth.

#### 6.6 Representation centering

Source: Mu and Viswanath, "All-but-the-Top: Simple and Effective Postprocessing for Word Representations", ICLR '18, arXiv:1702.01417; only its mean-removal step is used. Adopted by the pre-registered evaluation recorded in `validation.md`.

- `μ` is the arithmetic mean of article representatives (unit vectors) of a reference sample from the same model and representation; `center(v) = (v − μ)/||v − μ||`.
- Centered vectors are used for PinnerSage clustering and medoids, computed per representative at refresh, with `α_c = 1.6459373070` calibrated in centered space (`validation.md`; it supersedes the raw `α` of 6.2); and for ZoRRO's relevance term, `τ(c,h) = cos(center(e_c), center(e_h))`, which ZoRRO permits because its similarity function and representations are interchangeable. MMR `Sim1` is that relevance; MMR `Sim2` stays raw cosine because MMR was not part of the adopting evaluation (a reference measurement favoured raw `Sim2`: nDCG@10 0.3424 vs 0.3148).
- Native retrieval stays on raw vectors because the index stores raw representatives: the profile channel queries with the raw profile `Ŝ`, each medoid channel with the medoid's raw representative.
- The `u:<id>:article` record keeps `Ŝ` for retrieval. A second record `u:<id>:article:centered` in the same namespace stores the exact centered profile `normalize(Σ_i n_i·center(e_i))`, so `Σ_h cos(center(e_c), center(e_h))` keeps the rank-equivalent form of 6.1; it is written and verified together with the first and removed with it. The request-time approximation `center(Ŝ)` is not used: the pre-registered comparison found no significant difference (AUC 0.6782 vs 0.6447, Δ CI [−0.007, +0.077]), but it is not the standard formula and 94% of resamples favoured the exact form.
- `μ` is a versioned source asset (model, dimension, sample size, source, generation time) written only by its generator script from a vector file; loading checks model and dimension. Its version is part of the algorithm identifier (6.7) and of the user-record write token. The shipped value is provisional: the mean of the 1,945 cached MIND article representatives used in the evaluation; random subsamples of 50 already kept the gain (`validation.md`), and its use is subject to the same dataset-licence confirmation as `α_c`. The operator regenerates it from a sample of the production article index during the post-deployment replay and then refreshes user preferences, because stored centered profiles and clusters depend on `μ`.
- Collection ranking stays on raw cosine: its pre-registered check did not exclude 0 (nDCG@10 Δ +0.045, 95% CI [−0.040, +0.139], 29 users).

#### 6.7 Feedback recording interface

Reserved for calibration. It records and never changes ranking.

- Every recommendation response carries `impressionId` (UUID v4) and `algorithm`, a short hash of the section 6 parameter values and the `μ` version. The server records a `recommendation_served` event through the existing first-party event pipeline (`submitServerEvent`): impression ID, kind, algorithm, reason and the returned items with position, item ID and score. Empty responses are recorded with their reason.
- `POST /v1/recommendations/feedback` (authenticated) accepts `{ impression_id, kind, events: [{ item_id, position, action, occurred_at? }] }` with at most 50 events, `action ∈ {impression, click, save, subscribe, dismiss}` and `item_id` equal to the article `bookmarkUuid` or Collection `code` as returned. Identity comes from authentication. An invalid body is rejected whole and nothing is recorded; valid events become `recommendation_feedback` events in the same pipeline.
- Joining both event types by impression ID yields per-impression labels for ZoRRO's own evaluation (AUC, nDCG) and for replay calibration. Saves and subscriptions keep their existing endpoints; clients also report them here for attribution.
- No table, queue or scheduler is added. Records follow the existing analytics pipeline's retention; the deferred Security review covers this behavioural data.

### 7. Approved unified hybrid search

The latest explicit human correction authorizes implementation now and supersedes the earlier search deferral and rejected three-endpoint design. The existing `vector-v5-runtime` delta owns this contract; no new capability file or duplicate bulk-auth requirement is introduced. Agent514 owns production implementation; DeepSeek owns subsequent tests. This approval does not authorize a legacy serving cutover, production operations or a restart of the paused article recommendation feed.

#### 7.1 One normal authenticated HTTP contract

Expose only `POST /v1/search` with body `{keyword}`, a nonempty string of at most 500 Unicode code points. The latest correction removes the public `limit`, default 20 and final result cap. The first contract has no tag filter; do not emulate all-tags by post-filtering an unrelated top-K. Caller identity comes from normal authentication and current user state, not a body ID, task secret or whitelist exception. Existing auth, API-key and Edge identity rules are unchanged.

Return `text/event-stream` from the real request lifecycle. Four named channels are `titles`, `fulltext`, `article_vector` and `collection_vector`. Start title/fulltext work independently and start one query-embedding promise shared by both vector branches. Emit an admitted `partial` event as each successful channel settles, including an explicit empty outcome when applicable; do not await all branches or queue all partials behind the final merge. A failed channel emits `channel_error` with a safe reason, not an empty success, and does not suppress other channels. Shared embedding failure is reflected in both vector-channel outcomes while titles/fulltext can still succeed.

After every channel settles and final admission completes, emit exactly one `complete` event containing all fused admitted candidates, all channel statuses and any incomplete/truncation indicators, without a final result cap. Internal per-channel 100-candidate and fulltext scan budgets remain; no public limit does not authorize an unbounded database dump or exhaustive-coverage claim. This final ordered snapshot replaces provisional ordering rather than appending duplicates. Cancelled/disconnected requests stop delivery and additional paged work; they cannot promise a complete event after the connection is gone. No unauthorized title, snippet, entity ID or result count is emitted in partials or the final event.

A caller sends one ordinary authenticated POST and incrementally reads SSE frames; it does not call separate search endpoints. Example with operator-supplied local environment placeholders (not deployment credentials):

```sh
curl -N "$API_ORIGIN/v1/search" \
  -H "Authorization: Bearer $READER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"keyword":"distributed systems"}'
```

Each frame is `event: partial|channel_error|complete`, followed by one JSON `data:` line and a blank line. Partial payloads carry `channel`, `results` and `outcome`; clients may display them immediately keyed by typed result `id`. A channel_error marks that channel, not the whole request. The complete payload contains `results`, `channels`, `incomplete` and `replaces_partials: true`; `result_limit_reached` is removed. Replace the provisional list with all final fused admitted candidates. Existing index-only coverage is reported conservatively and does not imply provider failure: inspect each channel status and coverage reasons separately.

#### 7.2 Retrieval units and permissions

| Channel | Search units and scope | Independence and exclusions |
| --- | --- | --- |
| `titles` | Authorized Collection-member article titles; published/readable Collection subjects; the caller's subscribed RSS feed subjects and entry titles. Own article titles may also use the same ownership admission. | SQL/title retrieval does not require a body index or embedding. RSS retains the existing subscription and lab-feature gate; no global catalog, RSS body search, feed fetching or RSS vectors. |
| `fulltext` | The caller's current own saves plus currently readable member articles in actively followed Collections. | Use existing indexed text, including extracted PDF text when available. Bound D1 candidate pages and batch current PostgreSQL permission admission; never load complete user/subscription histories. |
| `article_vector` | The caller's own existing V5 article representatives, not another user's private vector or chunks as duplicate hits. | Native numeric `user_id` equality and representative `kind` filtering precede top-K; final ownership/readability admission remains mandatory. |
| `collection_vector` | Public/published, currently readable Collection aggregate representations. | Include eligible owned and already-followed Collections. Do not inherit recommendation-only own/subscribed exclusions or expand an aggregate hit into member articles. |

Article title/fulltext admission accepts current ownership or a current active, nondeleted, unexpired Collection subscription together with Collection/member readability. Own ownership also follows the personal reader's private_user boundary: a leftover own relation to another user's private snapshot is not an own origin. A separately readable followed-Collection relation may remain. Collection subject/vector hits are batch-hydrated against current publication, owner state and readability; vector admission additionally requires at least one currently eligible public member, so an aggregate cannot survive withdrawal of its last member. This extra content condition does not suppress an otherwise discoverable empty Collection subject in title search. RSS hits are admitted only for the caller's subscriptions and current lab access; a disabled gate yields no RSS identities or counts, not a global fallback. Search scope is distinct from automatic article recommendation admission: authorized query-driven Collection-member search does not recreate an article public pool or `recommendable` marker.

Collection article origins preserve the current reader's encoded owner-relation cb_id and owner bookmark-user UUID with collection_code in both partial and final HTTP output. Internal deduplication may retain raw IDs, but must not present those raw IDs as already encoded navigation. Each relation's title/alias remains attached to its own origin. Title retrieval retains or rechecks the matching title/origin at final admission; if that matching origin disappears, a surviving unrelated nonmatching origin cannot preserve its title-channel rank.

D1 fulltext scores/IDs are retrieval candidates, never permission authority. Fetch bounded candidate pages, apply parameterized PostgreSQL admission in batches, and continue only within a documented finite scan budget. If the budget is reached before exhaustion, mark coverage incomplete/truncated even when the admitted page is empty; do not report exhaustive no-matches. Expose per-channel coverage for the retained internal candidate/scan budgets; there is no final result limit. Revalidate current admission across the merged candidates before final fusion output; removed saves, expired subscriptions, closed Collections or lost RSS access cannot survive the final result merely because an earlier partial was authorized.

#### 7.3 One raw V5 query embedding and read-only execution

The two vector branches share one embedding of the keyword using the same raw V5 model, dimensions, normalization and matching task used by writes. Do not center the search query using recommendation means or mix it with preference vectors. Title and fulltext work must remain independent of provider latency/failure. Use existing valid article representatives and Collection aggregates; no source re-embedding, preference refresh, vector/index mutation, feed fetch, new embedding store or schema change. An unavailable representative or existing extracted fulltext is missing coverage, not permission to synthesize it during search.

The existing `/v1/bookmark/search` remains on jina-clip-v2 and its old buckets, with its existing optional all-tags behavior and response unchanged. This new route is additive, not an encoder/index cutover of the old route. Collection search is query-driven aggregate retrieval here, not an alias for Collection recommendation.

#### 7.4 Typed identities and standard unweighted RRF

Use Cormack, Clarke and Buettcher, *Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods*, SIGIR 2009, section 1: `https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf`. The source defines one-based ranks and fixes k=60. For each admitted typed entity, compute `RRF(d) = sum(1 / (60 + rank_channel(d)))` over successful channels containing it. Each entity contributes at most once per channel; a missing entity contributes nothing. Sort by decreasing RRF and use stable typed-identity ordering for ties, independent of channel completion order. No BM25/cosine/title score addition or normalization hacks, channel/preference/recommendation weights, freshness boosts, ZoRRO or MMR are part of search fusion.

Deduplicate using existing stored entity identities scoped by type: article, Collection, RSS feed and RSS entry are distinct types even if IDs or URLs coincide. The same authorized stored article matched across title/fulltext/own-vector channels appears once, retaining matched channels and all authorized own/Collection navigation origins. Distinct private snapshots are not collapsed by URL or canonical-source guesswork. Remove duplicate occurrences within a channel before assigning its one-based entity ranks; final current-state admission precedes the final fused list. No new persistent identity registry is required.

#### 7.5 Streaming lifetime and cancellation

Controllers own validation and SSE framing; the existing-style Domain Orchestrator owns concurrent channel execution, admission coordination and fusion; Repositories own SQL/native operations. Reuse the current DI/container/ContextManager graph, with no manual Pool or replacement connection graph.

The current Core path awaits `ctx.cleanup()` before returning a response. Implementation must make the smallest stream-aware cleanup deferral through that existing mechanism: retain resources until stream producer work settles, return the streaming response without waiting for work that needs the response consumer, and clean up once on success, failure or cancellation. Nonstream requests retain their ordinary cleanup timing. Avoid awaiting backpressure-blocked writes or stream completion before returning the Response; that creates a deadlock instead of genuine early SSE delivery. Propagate cancellation to delivery and additional repository pages, settle already-started work safely, and release resources without leaving rejected tasks unobserved.

The public Worker template retains its compatibility date and adds `enable_request_signal` so client disconnects can reach `Request.signal`; the earlier default runtime did not propagate that event in the local Workerd acceptance run. Source: Cloudflare's 2025-05-22 request-cancellation announcement, `https://developers.cloudflare.com/changelog/post/2025-05-22-handle-request-cancellation/`. Apply the flag to both Edge/Core configurations through the ordinary operator configuration path. The explicit 2026-11-06 follow-up permits only adding this flag to the sibling configuration repository's dev/beta/prod and retained main files, preserving their dates and other settings. Generated configuration tests cover both existing dates; the established real Workerd fixture verifies early results and socket cancellation with isolated dependencies. Neither test constitutes a production deployment or a private-resource run. A config lacking the flag is not evidence of disconnect cancellation working.

#### 7.6 Verification and version boundary

New search tasks remain unchecked until actual generated-route runtime tests prove early partial ordering, one complete event, independent failures, shared embedding, access revalidation, scan-budget honesty, standard RRF/typed dedup, cancellation and cleanup without deadlock. A compile or buffered mock response is not proof of streaming. Parent-reported marker checks (345 passed plus 3 existing monitor failures) and current auth checks (242 passed including actual Workerd) are scoped prior evidence only, not full-suite green or search acceptance. Task 3.7 remains open. If shared contracts or other shipped CLI/Extension/Mobile surfaces are affected, report the affected-app version decision to the parent/human; do not bump automatically. No production deployment, data operation or private configuration change is authorized.

### 8. Configuration and release sequence

1. Preserve the removed-draft boundary, existing business schema, historical migrations and private vector identities.
2. Retain fixed binding declarations and the native maintenance Workflow. This correction authorizes no private configuration, provisioning or production metadata/index cleanup; an unused article recommendable index may remain physically present.
3. After production-source changes finish, the delegated verifier runs current generation and standard checks on the final tree, without hand-editing generated outputs or treating older logs as current acceptance.
4. Historical refresh remains a separate operator action under vector-bulk-sync, not an operation performed or authorized by this documentation correction. Its script order is article → article-preference → collection → subscription (Collection-preference users); capacity counts private user/bookmark pairs and their chunks.
5. Preserve the marker correction and paused recommendation feed while agent514 implements the separately approved one-route hybrid search in section 7. DeepSeek verifies genuine streaming, channel scopes/admission, shared raw V5 query encoding, RRF/dedup and ContextManager lifetime on the final source. Existing bookmark search remains jina-clip-v2 with legacy buckets/all-tags; no old-route query/index cutover is authorized.
6. Keep search tasks unchecked until their evidence is recorded, retain lifecycle task 3.7 open, and report any affected shipped-application version decision through the parent without automatic version increments.

The earlier search deferral is superseded by the explicit implementation approval for POST /v1/search; no further confirmation is required for that contract. The old coordinated-cutover and indefinite dual-Workflow plans remain historical. Preserve the already-serving legacy endpoint. An operator-supplied article recommendation pool or a legacy serving cutover still requires separate authorization; this search adds neither a pool endpoint/script nor a compatibility platform.

## Risks / Trade-offs

- [Private copies increase vector count] → Plan capacity using eligible user-save pairs plus chunks; do not report canonical unique-bookmark counts as sufficient capacity.
- [Index metadata can lag business state] → Filter natively for scope and recheck current publication/read rules before returning results.
- [Refresh races with mutations] → Recompute current state and test replay/deletion explicitly; report unresolved concurrency behavior without adding a lock/lease platform.
- [No SQL vector ledger] → Current-state recomputation trades CPU/reads for a smaller architecture; failed operations remain explicit and can be retried.
- [Provider and large-PDF support] → Preserve honest failure/coverage outcomes; old fixture passes do not prove the new implementation or actual supplier limits.

## Deferred scope and evidence

Source-managed Collections, machine ingestion and Bot work are cancelled. Daily-reading business/UI work waits for a later Demo and human review; no disabled draft implementation or source-table sync projection is retained.

Earlier completion marks and logs remain evidence only for their recorded snapshots. Preserve the marker/paused-feed/Collection/privacy invariants separately from the new query-driven search. Parent-reported marker results are 345 passed plus 3 existing monitor failures; current refresh-auth results are 242 passed including actual Workerd, owned by vector-bulk-sync. Neither is full-suite green or search acceptance. The newly approved hybrid search requires actual-runtime evidence for section 7, with tasks 4.2/4.3/4.16-4.23 and lifecycle task 3.7 still unchecked. Agent514 implements; DeepSeek runs later tests/checks; parent reconciles evidence and any affected shipped-app version decision without automatic bumps. This documentation pass edits no source, runs no validation/tests and performs no private-config/cloud/production operation.
