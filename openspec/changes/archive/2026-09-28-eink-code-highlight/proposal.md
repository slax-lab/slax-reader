# Proposal

## Why

AI-chat code blocks are painted by highlight.js's bundled `atom-one-dark` stylesheet, which `apps/web/app/components/Markdown/MarkdownText.vue` imports as an unconditional global side effect. That stylesheet hardcodes a dark surface (`#282c34`) and a palette tuned for a dark background, and it consumes no `--slax-*` token — so it renders identically in all three themes, including e-ink. E-ink is a first-class theme here (tokens in `apps/web/styles/theme.tokens.css`, guarded by `apps/web/tests/theme/theme.tokens.spec.ts`), and a large dark fill is the single most expensive thing to draw on an ink panel: it forces a full-waveform refresh and ghosts, while the dark-tuned token colors collapse into low-contrast grays. The same screen already renders article code blocks as paper (`--slax-surface` + `--slax-border` in `apps/web/styles/article/_content-mixin.scss`), so the reader page shows two contradictory code-block treatments side by side.

## What Changes

- Introduce a code-highlight token family `--slax-code-*` in `apps/web/styles/theme.tokens.css`, defined in all three theme blocks (light / dark / e-ink): surface, text, border, plus eight syntax-role colors.
- Stop importing `highlight.js/styles/atom-one-dark.css`. Add a project-owned `apps/web/styles/code-highlight.css` that maps highlight.js's `.hljs` / `.hljs-*` class output onto those tokens and reproduces the structural rules the vendor file used to supply (block display, horizontal overflow, padding). highlight.js keeps producing class names only; the color decisions live in the theme layer.
- Register that stylesheet globally (alongside `styles/theme.css`) instead of from a component, so code-block styling no longer depends on which route chunk happens to load `MarkdownText.vue`.
- Make the chat code block a single themed surface: `pre.code-block-wrapper` carries the code surface, the highlighted `code.hljs` inside it becomes transparent. This removes the second background layer that `SnapshotChatPanel.vue`'s local `:deep(pre)` rule currently adds.
- E-ink palette: white surface with a 1px border (matching the article code block), black body text, and syntax differentiation by grayscale value plus weight/italic instead of hue. No translucent color, no dark fill.
- Light and dark keep the incumbent Atom One Dark surface and syntax values. Two visible deltas remain in those themes: the block is a single painted surface (the incidental light halo is gone and insets tighten), and the language label — which now sits on the code surface — takes the code text color instead of the page text color; without that second change the label was `#1a1814` on `#282c34`, effectively invisible in the light theme.
- Extend the theme-token guard tests: every theme must define the new tokens; the e-ink syntax palette must be grayscale and must clear a 4.5:1 contrast floor against the e-ink code surface; the code text (shared by the language label) must clear the same floor in every theme. Add a source guard asserting no `highlight.js/styles/*` import remains in `apps/web`.
- **Not** included: the extension's chat surfaces (`apps/extension` has its own `atom-one-dark` import and no e-ink theme); the legacy `apps/web/app/components/Chat/{ChatBot,BubbleMessage}.vue`, which no page or component references (only their own unit tests import them); the inert `code-block-header__copy` span; inline-code chips; and switching e-ink code blocks to wrapped lines instead of horizontal scroll.

## Capabilities

### New Capabilities

- `code-highlight-theming`: web code blocks derive their surface and syntax colors from theme tokens rather than an imported third-party stylesheet, with light/dark preserving the incumbent palette and e-ink rendering a paper-like grayscale treatment that meets a contrast floor.

### Modified Capabilities

(none)

## Impact

- **Code**: `apps/web/styles/theme.tokens.css` (new token family in three theme blocks); new `apps/web/styles/code-highlight.css`; `apps/web/styles/theme.css` (global import) and/or `apps/web/nuxt.config.ts` (`css:` registration); `apps/web/app/components/Markdown/MarkdownText.vue` (drop the vendor import); `apps/web/app/components/Snapshot/SnapshotChatPanel.vue` (replace the local `pre` background with the tokens).
- **Tests**: `apps/web/tests/theme/tokens.spec.ts` (mandatory-token list, e-ink grayscale + contrast assertions); `apps/web/tests/unit/components/Markdown/MarkdownText.spec.ts` (its `vi.mock('highlight.js/styles/atom-one-dark.css')` line goes away); new source-guard test.
- **Dependencies**: none added or removed; `highlight.js` stays a dependency (`apps/web` and `packages/frontend-utils`) and keeps doing the tokenizing, only its bundled stylesheet stops being imported.
- **Unchanged surfaces**: the parse-layer markup from `packages/frontend-utils/src/parse.ts` (`.hljs`, `code-block-wrapper`, `code-block-header`) is untouched, so the extension and the mermaid failure fallback keep working; the mermaid diagram light backdrop stays pinned to `#ffffff` on purpose and must not be tokenized.
- **Specs**: `chat-diagrams` requirements are preserved — non-mermaid blocks still render as syntax-highlighted code, and the diagram backdrop rule is untouched.
