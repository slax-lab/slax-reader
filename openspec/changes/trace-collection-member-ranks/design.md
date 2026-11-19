## Decisions

An authenticated, deployment-allowlisted caller sends `Prefer: slax-rank-trace` to the existing Collection GET. The email comes from the request context. The endpoint returns the normal response and its impression ID. Ordinary readers, article requests and requests without the preference follow the existing path.

The served list and the comparison share one native recall, subscription preference, Collection readback and ranked shortlist. The comparison admits up to twelve current eligible members per Collection, excludes viewer saves and applies Collection MMR to the eligible groups. It reads article representatives by exact owner and bookmark identity for chosen groups, then rechecks visibility before recording the alternative. Membership can change during those reads. The baseline records what was served.

Trace version 1 mirrors the proposed Discover member selection. The viewer's saved-article preference, or the subscription preference if absent, supplies cosine affinity. A positive affinity is multiplied by `0.9 + 0.1 * exp(-0.015 * ageHours)` using stored publication time. Unknown or future times receive 0.9. URL deduplication, the existing MMR and recent eligible fillers select up to three members. All variants use one scoring timestamp and the same member rows and vectors.

## Reading a trace

Look up the response's impression ID in `reader-lake.logs.events` within the request's ingestion and occurrence window. A `recommendation_comparison_finished` record gives the status and expected number of distinct Collection records. Treat missing rows or a failed marker as incomplete evidence. Wait for ingestion before comparing counts.

Each `recommendation_collection_comparison` record gives the Collection code and score, zero-based served and alternate positions, served bookmark UUIDs and the alternative orders. A null position means the Collection was absent from that list. The `ranked` array is the full alternative. Compare it with `without_freshness` to isolate publication age or with `using_subscriptions` to isolate replacing the saved-article profile. Candidate rows retain UUID, the two cosines and the publication multiplier. Missing vectors have null affinities. Differences versus the served list alone may also reflect admission, deduplication or diversity. The lists represent server selections; a client's featured topic and viewport determine what is visible.

The event payload omits raw embeddings, private saves, titles, email addresses, URLs and request headers. A diagnostic failure is recorded as failed and the baseline remains available. Production collection and ingestion can be verified after release.
