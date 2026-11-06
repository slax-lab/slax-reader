# Design

## Decisions

- Extend the existing aggregate helper with optional coverage accounting supplied only by refreshUser. Without that argument, its strict Collection behavior remains unchanged. Count all enumerated rows, increment missing for absent by-ID results and continue; only valid present vectors contribute to sums and the existing visit callback.
- Attach optional numeric coverage to VectorRefreshResult for user preferences. Keep publication state written for a valid partial result; callers can distinguish coverage from native write visibility. The CLI validates and preserves only the three safe numeric counters.
- A nonempty eligible set with zero used vectors throws no_usable_preference_vectors before the stale-profile deletion branch. This preserves old profiles. An empty eligible set still deletes them.
- Do not catch vector reads or normalization errors as absence. No intermediate profile is written; raw, centered and cluster calculations complete before the final existing upsert.
- Preserve request routes, Workflow sequencing, algorithms, Collection representations and all source-file behavior. No recovery platform, extra storage or cloud mutation is part of implementation verification.

## Trade-offs

Partial preferences intentionally omit unavailable contributions and can change when those vectors become available; coverage makes this visible. All-missing preferences remain explicitly incomplete rather than deleting last-known output. Operational failures still fail the target so a service outage cannot silently erase most history.
