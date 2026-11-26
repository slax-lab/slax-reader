# Design

## Context

The chat model can invoke a custom web-search function. The function makes a separate Vertex AI `generateContent` request with the built-in Google Search grounding tool. The configured model of the outer chat request does not populate the inner request. Both Web chat panels share the same event-stream parser and already render a localized search-failure message when given a failed status.

## Goals / Non-Goals

**Goals:** Restore the provider request and show the search tool's actual outcome in the existing Web chat UI.

**Non-Goals:** Model migration, new UI or protocol fields, and changes to bookmark search.

## Decisions

Pass the existing Chat default, `gemini-3-flash-preview`, explicitly in the search-tool request. This model supports Google Search grounding and is available through the existing Vertex AI express-mode API. The Web parser passes a failed status to the existing failure handlers in both panels. The panels match the localized pending suffix case-insensitively so English `Searching...` is replaced along with the loading state.

The search summary is a tool result for the outer chat model. Web and Extension interpret content in the completion event as structured links. Send `null` in the event when no link records are available, using the existing nullable delta field. Both clients already handle an empty result without rendering link cards.

Cover the missing-model regression at the search-tool boundary and the failure event in the shared parser. Exercise the running UI with controlled stream events and verify real Google grounding with a source-bearing response when provider access is available.

## Risks / Trade-offs

The provider can return generated text without grounding sources. The verification checks source metadata to distinguish an actual Google Search result from a model answer.
