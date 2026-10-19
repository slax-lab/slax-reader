# Proposal

## Why

Deleting a tag from the Web tag list already succeeds on the API, including when the tag is attached to bookmarks. The API intentionally returns an empty successful response, but the modal treats the empty response body as failure and shows a misleading error toast, making users think the tag was not deleted.

## What Changes

- Treat a completed `/v1/tag/delete` request with no response data as a successful deletion.
- Keep the dialog open when the request layer returns its expired-session sentinel or throws a request error.
- Add regression coverage for the empty success response and the expired-session response.

## Capabilities

### New Capabilities

- `bookmark-tag-deletion`: Defines the user-visible success and failure behavior for deleting a tag from the tag list.

### Modified Capabilities

<!-- No existing living capability spec covers tag deletion. -->

## Impact

- Web tag deletion modal and its unit tests.
- No API endpoint or database behavior changes.
