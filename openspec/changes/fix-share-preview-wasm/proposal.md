## Why

Cloudflare Pages returns HTTP 500 when it renders the fallback preview image for a public article without a cover or body image. The article itself still publishes a dynamic Open Graph image URL. The change requester approved the proposed Yoga WASM static import and a Pages smoke test in conversation on 2026-11-24.

## What Changes

- Make the Pages build load Satori's Yoga WASM through a static module import.
- Exercise the built Pages Worker from a public text-only article through its generated Open Graph PNG.

## Non-goals

Other share-card designs, image selection policies, and Cloudflare project settings are outside this change.

## Capabilities

### New Capabilities

- `public-share-preview` covers the public article's dynamic share image fallback.

### Modified Capabilities

None.

## Impact

The Web Pages Worker build and an offline Pages release smoke check.
