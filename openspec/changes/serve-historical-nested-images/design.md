# Design

## Context

The edge entry sends matching GET requests directly to `handleImageProxy`. The handler checks the outer signature and Reader Referer, decodes the source, and uses `caches.default`, R2 and finally `publicFetch`. Today the source for a historical outer request is the inner endpoint. Supplying the article Referer to that endpoint causes the observed 403. The previous Web change does not change the stored URLs.

## Goals / Non-Goals

Make an eligible outer request behave like a direct inner request without another HTTP hop. Do not change the incoming allowlist, the public-target policy, the signing format, or either client's redirect policy. Do not recursively repair arbitrary input or enumerate production R2.

## Decisions

- Resolve once, within the original request. Before serving any cached bytes, admit the outer request, then recognize a complete signed inner URL by the configured origin and exact path. Verify its effective signed fields using the same decoding and signature semantics as a direct request. Do not reconstruct or re-sign it. Check its decoded original with the existing public-target policy and decline recovery if that target is the proxy endpoint, even if the next layer has no valid signature. Incomplete, ambiguous or mismatched inputs fall through to the existing path. Keep single-layer generation behavior unchanged.
- Carry the verified inner URL and signed `u`/`r` forward into the existing serving path. Use its URL for the Worker cache key and its `u` for the existing mode-specific R2 key. This reuses inner image data, avoids historical outer cache entries, and applies inner upstream Referer handling. Retain the original method, incoming headers/range and the same streaming, MIME, byte and redirect policies as a direct request. No recursive network or handler call is required.
- Do not redirect clients to the inner proxy. Android manually checks `imageOriginal` at each hop and disables automatic redirects; iOS gates `willPerformHTTPRedirection` on `imageOriginal`. Both recognize configured signed proxies, but a redirect adds a round trip and depends on the policies of already-installed builds. Direct serving avoids both dependencies.
- Ordinary and RSS are the only signer modes. Ordinary capture also signs video sources and posters; handle eligible requests according to the existing mode, not by X hostname or file extension. Same-mode RSS must keep its 3 MiB cap, safe image MIME checks, range rejection and no-source-redirect rule. There is evidence for ordinary nested X images, not for double-wrapped RSS objects in production.

## Risks / Trade-offs

- A downstream cache can answer before the Worker sees the request. `responseRedirect` uses `corsCacheHeader`, so the failure 302 advertises `public, max-age=31536000`. `applyCacheHeaders` only replaces the header on eligible 200s; the route's 30 days do not apply to the 302. The handler does not put this failure in `caches.default` or R2. `HIT-SLAX-CACHE: 1` is a static response header, not proof of a cache hit.
- Current native Android uses OkHttp with `cache(null)`; iOS uses `reloadIgnoringLocalCacheData`. These facts do not establish the cache behavior of all historical WebViews, native builds or external intermediaries.

## Migration Plan

No stored-data or client migration. After a separately authorized rollout, compare a fresh GET of a known affected outer URL without following redirects against its direct inner response. If an intermediary serves a stale 302, invalidate the exact original **outer GET URLs**, including the complete original encoded query and any configured cache-key variants, in that cache. Do not purge inner URLs, `notfound.png`, R2, or the whole zone. There is no Worker Cache API failure entry to purge. Browser-local fresh redirects cannot be evicted by an edge purge; clear/bypass that client's HTTP cache or wait for expiry. No production cache hit or zone override was verified and no remote action is authorized here. Rolling back the Worker restores prior behavior without modifying any bookmark.
