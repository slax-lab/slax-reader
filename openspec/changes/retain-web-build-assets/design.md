# Design

## Context

See `proposal.md` - Why. The release helper `tooling/web-pages-deploy.mjs` stages the build, calls `preparePowerSyncRetention` (`tooling/powersync-retention.mjs`), uploads with `wrangler pages deploy`, confirms the deployment, and purges the hostname. Retention lists production deployments through the Pages API, selects those replaced within 7 days plus the boundary predecessor and the canonical deployment, reads each one's `/_nuxt/powersync-assets.json` from its `<hash>.<project>.pages.dev` address, verifies each listed file's digest and type, rejects HTML, and copies verified files that do not conflict into the staged directory. The index is written by a Nitro `compiled` hook in `apps/web/nuxt.config.ts`, from a Vite plugin that records the Worker graph. Pages keeps the 100 most recent deployments and any deployment younger than 30 days, so every deployment the window selects is still readable.

## Goals / Non-Goals

**Goals:**

- Reuse the existing selection, download, verification, conflict, and warning logic for all `/_nuxt/` files, so there is one retention path.
- Keep the PowerSync index, its graph validation, and its revalidation headers exactly as they are.

**Non-Goals:**

- Retaining non-hashed outputs (HTML, payloads, `builds/latest.json`, `sw_prod.js`).
- Changing Cloudflare Access, cache purge, or routing; serving real 404s for missing assets.
- A user-facing update notice (separate change `web-update-notice`).

## Decisions

### A second, flat index of every `/_nuxt/` file

In the same Nitro `compiled` hook, after the PowerSync index is written, walk `<publicDir>/_nuxt/` and write `/_nuxt/build-assets.json`: `{ "assets": [{ "path", "sha256" }] }`, sorted by path, excluding the two index files themselves. It is a flat list rather than a dependency graph: Nuxt's own chunks, CSS, fonts, and images are referenced from HTML, payloads, and other chunks in ways the PowerSync JavaScript parser does not model, and a page needs whichever subset it happens to request. Paths are validated with the same pattern as PowerSync assets, widened to the extensions the build emits (`js`, `mjs`, `css`, `wasm`, `woff`, `woff2`, `ttf`, `png`, `jpg`, `jpeg`, `svg`, `gif`, `webp`, `json`).

Alternative: one combined index. Keeping PowerSync's graph index separate preserves its stricter reachability validation and its no-cache headers, which general assets do not need.

### Recovery reuses the snapshot loop

`preparePowerSyncRetention` (name and module kept, so `web-pages-deploy.mjs` still calls one entry point), for each selected snapshot, recovers the PowerSync graph as today and then reads `build-assets.json`. A deployment that predates the index yields a warning (`missing-build-index`) rather than an inferred inventory. Each listed path is downloaded from the snapshot origin, checked for HTML and digest, and merged with the same rules as today: a path present in the current build is never overwritten, two snapshots disagreeing on a path drops it with `historical-conflict`, and a path is written once. Content-type checks map by extension (`text/css`, `font/*` or `application/font-*`, `image/*`, `application/json`, JavaScript, WASM, and JSON or plain text for source maps). Downloads run with bounded concurrency (8) and the existing 15-second per-request timeout.

Alternative: diffing HTML of old deployments to find referenced files. That misses chunks loaded only after navigation.

### Summary and warnings

The summary table gains a "Build assets" row beside "Current runtime" and "Added historical dependencies", with files and bytes, and a per-deployment coverage count. Warnings keep the existing `category`/`path`/`deployment` shape, so the Actions annotations stay readable. Coverage is `unknown` when any selected deployment could not be read.

## Risks / Trade-offs

- [Deployment size grows] → Only files absent from the current build are added; content hashing means unchanged files are not duplicated. With 407 files per build and most unchanged between releases, a week of releases adds hundreds of files, far under the 20,000-file limit; the summary reports the count so growth is visible.
- [Release time grows with downloads] → Bounded concurrency and per-request timeouts; failures warn and continue.
- [A retained stylesheet or chunk references a file that was not retained] → All files a deployment emitted are listed and retained together, so references inside one build resolve; a partial recovery is reported as such.
- [A project re-enables Access on deployment addresses] → Its releases report every deployment as `download-unavailable` and coverage `unknown`, and publish the current build as before.

## Migration Plan

The first release with this change writes `build-assets.json` but finds none in earlier deployments, so it warns and retains only PowerSync assets as today. From the second release on, earlier deployments carry the index and their assets are retained. Rollback is a revert; deployments that already carry retained files are unaffected.
