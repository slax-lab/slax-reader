# Proposal

## Why

When a user asks the AI chat to draw a diagram (e.g. a swimlane chart for a complex multi-actor article), the model already emits mermaid syntax spontaneously, but every chat surface renders it as a plain code block — users must read raw diagram source instead of the diagram. The gap is purely in rendering; the model-side behavior already exists but is unpinned (it may also answer with ASCII art or other formats).

## What Changes

- Render closed ```` ```mermaid ```` fenced code blocks in AI chat messages as diagrams (SVG) instead of code blocks, on the web chat surface: `Snapshot/SnapshotChatPanel.vue` (which serves both the bookmark reader page `pages/b/[id]` and the shared snapshot page `pages/s/[id]`). Note: `apps/web/app/components/Chat/ChatBot.vue` is currently unreferenced by any web page (dead code) and is not wired in this change.
- The browser extension is **not** included: WXT forces `inlineDynamicImports` for the content-script bundle, so mermaid (~1.6 MB gzipped) would be inlined and parsed on every page load. Extension support is deferred to a follow-up change using on-demand script injection.
- During streaming, an unclosed mermaid fence keeps rendering as a regular code block; once the fence closes, the block upgrades to the rendered diagram.
- Rendered diagrams scale to fit the chat bubble width; clicking opens a full-view overlay with zoom and pan.
- When mermaid rendering fails (invalid syntax from the model), fall back to showing the original code block plus an error notice. No blank output, no AI-feedback button (explicitly out of scope).
- Add one line to the chat rules in `apps/api/src/const/prompt.ts`: when the user asks for a diagram, answer with a ```` ```mermaid ```` fenced code block. This pins the existing spontaneous behavior into a contract; it does not encourage unprompted diagram output.
- Add `mermaid` as a dependency of `packages/frontend-utils`, loaded only via dynamic import so the web bundle does not pay for it unless a diagram is actually rendered.
- No telemetry/observability instrumentation (explicitly declined).

## Capabilities

### New Capabilities

- `chat-diagrams`: AI chat can emit mermaid diagrams on request (prompt contract), and the web chat surface renders closed mermaid fenced blocks as diagrams with streaming-safe behavior, failure fallback, and full-view inspection.

### Modified Capabilities

(none)

## Impact

- **Code**: `packages/frontend-utils/src/parse.ts` (mermaid fence detection + placeholder output) and a new `packages/frontend-utils/src/mermaid.ts` (hydration helper); `apps/web/app/components/Snapshot/SnapshotChatPanel.vue` (post-render hydration at the `v-html` update site); a new diagram-viewer overlay component in `apps/web`; `apps/web/config/uno.base.ts` (one-line fix: UnoCSS `content.pipeline.exclude` patterns must be globs (`**/node_modules/**`) or the build breaks once mermaid enters the bundle); `apps/api/src/const/prompt.ts` (one-line chat rules addition).
- **Dependencies**: new `mermaid` dependency in `packages/frontend-utils` (dynamic-imported only).
- **APIs**: no API contract changes; prompt change alters chat response formatting only.
- **Bundle size**: mermaid is large; in the web build it stays a lazy chunk (verified: separate 2.5 MB dynamic chunk, not preloaded). Extension excluded — see What Changes.
- **Security**: rendered SVG is inserted via DOM APIs, bypassing DOMPurify; mermaid runs with `securityLevel: 'strict'` + `htmlLabels: false` and the SVG is sanitized (SVG profile) before insertion.
