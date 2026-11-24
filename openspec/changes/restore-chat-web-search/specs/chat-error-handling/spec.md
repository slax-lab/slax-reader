# Spec Delta

## ADDED Requirements

### Requirement: Chat web search reports its tool outcome

When Chat invokes web search, the server SHALL submit a Google Search grounding request with a supported model. The server SHALL emit the search tool's failed status if that request raises an error. The Web reader and snapshot chat panels SHALL end the pending search indicator and show a localized failure for that status.

#### Scenario: Chat invokes Google Search

- **WHEN** the chat model invokes the web-search tool for a query
- **THEN** the server sends a Vertex AI generation request with an explicit model and the Google Search grounding tool, and passes the returned search summary to the chat model

#### Scenario: Google Search fails during Web Chat

- **WHEN** a Web reader or snapshot chat starts a search and the server sends `finished_failed` for the search tool
- **THEN** the pending indicator ends and the existing localized search-failure message is displayed

#### Scenario: Google Search succeeds during Web Chat

- **WHEN** the search tool returns a plain-text summary for the chat model
- **THEN** the server sends `finished_successfully` with a null content field, and the client can complete the search indicator and continue rendering the assistant response without creating link cards from the summary
