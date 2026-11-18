# Allow PDF uploads with Reader API keys

## Why

The collector can authenticate its publication accounts and save article URLs in beta. Uploading an original PDF with the same key currently returns the API key route denial before the PDF handler runs.

## What Changes

- Admit an authenticated POST to the existing PDF upload endpoint through CLI API key authentication.
- Apply the PDF Labs setting and existing account, file size, signature, ownership and processing rules to the authenticated owner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pdf-bookmarks`: An opted-in account can upload PDF bytes with its existing Reader API key.

## Impact

The API authentication middleware and its route coverage are affected. The existing clients, upload payload, response and database schema are sufficient.
