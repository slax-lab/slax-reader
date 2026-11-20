# Proposal

## Why

Each Web release replaces every content-hashed file under `/_nuxt/`, and Pages answers a request for a missing one with the HTML shell and status 200. A page opened before the release then loads HTML where it expects JavaScript, CSS, or WASM, and breaks (`Unexpected token '<'`, `expected magic word 00 61 73 6d, found 3c 21 44 4f`); because the response succeeds, Nuxt's chunk-error reload does not run either. The release purges the hostname's edge cache, so no cached copy survives. The existing retention step keeps only the PowerSync Worker graph (16 files), and until the test project's Access policy was removed on 2026-11-20 it could not read earlier deployments at all: every dev and beta release logged `download-unavailable` and retained nothing. On the test environment, of the 25 entry files a page from a few releases earlier references and the newest build lacks, 7 now return HTML from `r.slax.dev`.

## What Changes

- Extend release retention from the PowerSync Worker graph to every file the Web build emits under `/_nuxt/`: page and component chunks, stylesheets, fonts, images, Worker scripts, and WASM, for each production deployment replaced within the last 7 days.
- Each build records the files it emitted under `/_nuxt/` with their digests in a generated index served beside them, so a later release can recover exactly that set from the earlier deployment's own `pages.dev` address and verify it.
- Recovered files keep their original paths and bytes and never replace a file of the current build; a file whose content conflicts, cannot be downloaded, or arrives as HTML is skipped with a warning, as PowerSync retention already does.
- Release summaries report retained files and bytes for both the PowerSync graph and the general build assets, and the coverage per earlier deployment.
- The test, beta, and production projects no longer require Cloudflare Access on deployment addresses (changed in the Cloudflare dashboard on 2026-11-20); this change does not alter Access.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-pages-release`: releases retain recent earlier builds' `/_nuxt/` assets, and summaries report the result.

## Impact

- `tooling/`: the release helper, a generalized asset index, and their tests; `apps/web/nuxt.config.ts` hooks that write the index at build time.
- Deployment size grows by the files that differ across the retained window; Pages allows 20,000 files per deployment and 25 MiB per file, and one build emits 407 files (31 MiB) under `/_nuxt/`.
- No change to the application runtime, API, data, or UI.

## Assumptions

- The 7-day window and the selection of earlier deployments are the ones PowerSync retention already uses.
- Files outside `/_nuxt/` (HTML, `_payload.json`, `builds/latest.json`, the Service Worker) are not retained: they are not content-hashed and must reflect the current build.
- Deployment addresses stay readable without Cloudflare Access; that is a project setting outside this change.
