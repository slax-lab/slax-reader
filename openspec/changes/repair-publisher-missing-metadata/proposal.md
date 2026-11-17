## Why

Re-submitting a completed publisher bookmark currently returns its cached content. Historical Collection entries can display an empty title, site or byline even when the collector supplies those fields.

The ordinary WeChat adapter also receives the signed author and account name but discards both when building the document passed to the parser.

## What Changes

- Preserve the supplied author (or account nickname when unsigned) and the WeChat site name when building ordinary article HTML.
- On the existing inline-add path, let an allowlisted publisher fill blank metadata on its own matching, completed HTML bookmark from the attributed capture it submits.
- Reuse the existing bookmark relation and stored body. Preserve populated fields and user-edited titles. Verify the original URL, Reader permalink and star through both owner and public reads before processing a second batch.

## Capabilities

### New Capabilities

### Modified Capabilities

- `private-bookmark-snapshots` gains a fill-only metadata operation on a publisher's existing private HTML snapshot.

## Impact

Affects the cached inline-add branch and the Reader bookmark repository. The existing collector sends the necessary HTML metadata. The request and response schema, database schema and clients remain compatible.
