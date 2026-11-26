# Proposal

## Why

Chat reaches the web-search tool, but the secondary Vertex AI request omits a required model ID and fails before any network request. Web also interprets the tool's failure frame as a completed search, which makes a failed attempt look successful.

## What Changes

- Restore Chat's Google Search calls by selecting an explicit grounding-capable model for the search request.
- Send a completion event without link data when the provider yields a plain-text summary for the chat model.
- Render failed web searches with the existing failure message and stop the pending indicator in the Web reader and snapshot chat panels.
- Verify the model argument, tool-status handling, and search behavior in a running environment.

## Capabilities

### New Capabilities

### Modified Capabilities

- `chat-error-handling` covers web-search execution and the user-visible outcome of search-tool failures.

## Impact

The change affects the API search-tool implementation, the shared Web Chat stream consumer, and focused regression tests. The requirements were reviewed in conversation, where the change requester asked to implement this repair and open a pull request.
