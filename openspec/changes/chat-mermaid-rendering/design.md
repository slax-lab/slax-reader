# Design

## Context

Chat markdown rendering is a shared pipeline: `markdown-it` + `highlight.js` + `DOMPurify` in `packages/frontend-utils/src/parse.ts` (`parseMarkdownText`), consumed via `v-html`. In scope is one live surface — the web snapshot chat panel (`apps/web/app/components/Snapshot/SnapshotChatPanel.vue` + `Chat/BubbleMessage.vue`, serving both `pages/b/[id]` and `pages/s/[id]`). The extension's chat (`apps/extension/src/components/Chat/ChatBot.vue`) was descoped during implementation: WXT builds the extension's chat UI into a content-script bundle with forced `inlineDynamicImports`, so mermaid (~1.6 MB gzipped) would be inlined and parsed on every page load; extension support waits for a follow-up change using on-demand script injection. `apps/web/app/components/Chat/ChatBot.vue` is currently unreferenced by any page and is out of scope. Streaming re-parses the full accumulated markdown and re-injects `v-html` on every SSE delta (`SnapshotChatPanel.vue`'s buffer accumulation).

Constraints that shape the approach:

- markdown-it treats an unclosed fence as closed at end of input, so the `highlight(code, language)` callback cannot distinguish a closed mermaid fence from one still streaming. Closure must be determined from the raw source before render.
- The `v-html` output passes through DOMPurify, so whatever the mermaid block becomes must survive sanitization; rendered SVG cannot be inlined at parse time (and cannot be, since rendering is async).
- No existing lightbox/image-viewer component exists to reuse for full-view inspection.
- Chat prompts live in `apps/api/src/const/prompt.ts` with per-platform rule blocks (`chatMobileRules`, `chatDesktopRules`); the format contract must apply to every chat platform.

## Goals / Non-Goals

**Goals:**

- Parse layer emits a sanitizer-safe placeholder for closed mermaid fences; a shared hydration helper renders them client-side.
- Streaming frames never attempt mermaid rendering on unclosed fences, and re-hydration after each `v-html` replacement is cheap (no re-render of already-rendered diagrams).
- Rendered SVG is XSS-safe even though it bypasses the main DOMPurify pass.
- `mermaid` is loaded only on demand (dynamic import) in the web build.

**Non-Goals:**

- No AI-feedback / "ask AI to fix" button (user explicitly declined).
- No telemetry or observability instrumentation (user explicitly declined).
- No regenerate/delete-message mechanics.
- No attempt to auto-repair invalid mermaid source client-side.

## Decisions

### D1: Placeholder + post-render hydration, not inline render

`highlight()` in `parse.ts` returns a placeholder `<div class="mermaid-placeholder">` carrying the HTML-escaped mermaid source as its text content (text nodes survive DOMPurify unchanged). A shared `hydrateMermaidDiagrams(rootEl)` helper in `frontend-utils` scans for placeholders after `v-html` updates, dynamically imports mermaid, renders, and inserts the SVG via DOM APIs.

Alternatives considered: (a) a markdown-it plugin that renders mermaid synchronously — rejected, mermaid rendering is async and its SVG would be stripped or need DOMPurify rule surgery; (b) a dedicated Vue component replacing `v-html` for chat bubbles — rejected, too invasive across both surfaces for no behavioral gain.

### D2: Closure detection by pre-scanning raw markdown

Before calling `mdi.render`, `parseMarkdownText` scans the raw source for fences; a ```` ```mermaid ```` opening fence without a matching closing fence is downgraded (its info string rewritten so `language !== 'mermaid'`), making it render as a plain code block. This is deterministic, unit-testable, and keeps the streaming rule ("render only closed fences") entirely inside the pure parse layer — surfaces need no streaming awareness.

Alternative: detect closure inside `highlight()` via token metadata — rejected, the callback receives only `(code, language)`; reaching token state from there is fragile.

### D3: Render-result cache keyed by source

Hydration keeps a module-level `Map<source, { svg } | { error }>` so the full-`v-html`-replacement on every streaming delta only re-inserts already-computed results instead of re-calling `mermaid.render`. Without this, a completed diagram above the streaming text would re-render (flicker + CPU) on every chunk.

### D4: Failure fallback reuses the code-block path

When `mermaid.render` throws, hydration replaces the placeholder with the same code-block markup the parse layer would have produced (reuse/export the existing `highlightBlock` helper) plus an error notice element. The render error is cached (D3) so the fallback is stable across subsequent streaming frames.

### D5: Security — strict mermaid config + sanitize the SVG

Initialize mermaid with `securityLevel: 'strict'`, `startOnLoad: false`, `htmlLabels: false`, and `suppressErrorRendering: true`, then run the rendered SVG through DOMPurify (SVG profile) before insertion. Diagram source is model output shaped by arbitrary web content the user saved — prompt injection into diagram labels is a real vector since this path bypasses the main sanitize step.

`suppressErrorRendering: true` is required for a clean failure path: without it, mermaid draws an error diagram into a temporary container on `document.body` and its throw skips `removeTempElements()`, leaking one error diagram per failure. With it, both failure branches clean up before rethrowing, which is exactly what the hydration catch + fallback expects.

`htmlLabels: false` is load-bearing: with HTML labels on (the default), mermaid emits `<foreignObject>` for node labels, and DOMPurify's SVG profile strips `foreignObject` including its contents — so every node label vanished (verified in real Chromium). Allowlisting `foreignObject` restores labels but still drops `<br/>`, collapsing multi-line labels. With `htmlLabels: false`, labels are plain `<text>/<tspan>` (fully inside the SVG profile), multi-line labels render correctly, and the HTML-injection surface in labels disappears entirely. Trade-off accepted: no bold/links inside diagram labels.

### D6: Sizing and full-view overlay

In-bubble: SVG gets `max-width: 100%; height: auto` (scaled overview). Click opens a new minimal overlay component (no existing viewer to reuse) rendering the same cached SVG at natural size with zoom (buttons/wheel) and pan (drag). The overlay lives in each app's components, fed by the shared cache — the SVG string is app-agnostic.

### D7: Prompt contract in shared chat rules

Add one line to the chat rules in `apps/api/src/const/prompt.ts`, placed so it applies to both mobile and desktop rule blocks: when the user explicitly asks for a diagram or chart, express it as a ```mermaid fenced code block. No encouragement of unprompted diagrams.

### D8: Dependency placement and loading

`mermaid` is declared in `packages/frontend-utils` dependencies and imported only via `import('mermaid')` inside the hydration helper, so bundlers split it into an on-demand chunk. Apps never import mermaid directly. Declaring it in the shared package is required for module resolution: with pnpm's isolated `node_modules`, an `import('mermaid')` inside `frontend-utils` would not resolve to a dependency declared only by the apps. The parse module (`parse.ts`) itself never references mermaid — it only emits placeholders.

Note: this dynamic-import strategy works for the web (Nuxt) build — verified as a separate lazy chunk, not preloaded. It does **not** work for the extension: WXT forces `inlineDynamicImports` on the content-script bundle, inlining mermaid into every page load. That is why the extension was descoped; the follow-up extension change needs on-demand injection (`chrome.scripting` or a web-accessible chunk) rather than a static import of the helper.

## Risks / Trade-offs

- Model emits invalid mermaid (special chars in labels, etc.) → failure fallback shows source + error; user can still ask the AI to retry manually.
- Dynamic import adds a first-render delay (mermaid is several hundred KB gzipped) → acceptable; placeholder shows code block until the chunk loads, so the user sees content immediately.
- Streaming re-hydration still re-inserts SVGs on every delta → cheap DOM insert from cache; if profiling shows jank, debounce hydration to fence-close events (not needed for v1).
- Extension bundle/chunk loading: WXT inlines all dynamic imports into the content-script bundle → extension descoped in this change; follow-up needs on-demand script injection (recorded in D8).
- The fence pre-scan (D2) must handle mermaid fences nested inside other constructs (blockquotes, lists) conservatively → when in doubt, treat as unclosed/plain code block; worst case is showing source instead of a diagram, never a broken render.

## Migration Plan

Pure additive frontend behavior + a one-line prompt addition. No data or API migration. Rollback = revert the PR; old behavior (code blocks) is the fallback path of the new code anyway.

## Open Questions

(none)
