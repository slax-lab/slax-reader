# Design

## Context

See `proposal.md` — Why. What shapes the approach:

- **Markup is shared and must not change.** `packages/frontend-utils/src/parse.ts` emits code blocks as `<pre class="code-block-wrapper"><div class="code-block-header">…</div><code class="hljs code-block-body {lang}">…</code></pre>`. Consumers: the web chat panel (`SnapshotChatPanel.vue`, the reported surface), the web AI-outline panel (`Markdown/AIOutlineText`-side use of `Markdown/MarkdownText.vue`), the extension's chat, and the mermaid failure fallback (`packages/frontend-utils/src/mermaid.ts` reuses `highlightBlock`). Only the web surfaces are in scope, but all of them keep working because the markup is untouched.
- **Today's styling is two unrelated layers.** `apps/web/app/components/Markdown/MarkdownText.vue:12` imports `highlight.js/styles/atom-one-dark.css` as a global side effect (dark surface + full dark-tuned palette, theme-independent); `SnapshotChatPanel.vue`'s `:deep(pre)` rule adds a `color-mix(in srgb, var(--slax-text) 6%, transparent)` background on the wrapper. `code-block-wrapper` / `code-block-header` / `code-block-body` have no CSS anywhere in the repo, and the language label / copy span are inert.
- **Theming is entirely `--slax-*` tokens.** `@nuxtjs/color-mode` writes both `<html class="<preference>">` and `<html data-slax-theme="<preference>">` (`apps/web/nuxt.config.ts` `colorMode.classSuffix: ''`, `dataValue: 'slax-theme'`), and `[data-slax-theme='…']` blocks in `apps/web/styles/theme.tokens.css` carry the values. UnoCSS's dark variant is keyed to the `.dark` class only (`apps/web/config/uno.base.ts`), so under e-ink every `dark:` variant silently falls through to its plain branch — theme-dependent styling must be authored per theme, never as "not dark".
- **`theme.tokens.css` has an injection constraint.** It is the file injected into the reader's iframe article preview (and optionally into CE shadow roots), and `apps/web/tests/theme/tokens.spec.ts` asserts it contains no `html` / `body` / `*` rule, no `@media`, and no `@keyframes`. New *selectors* therefore cannot live there — only variable declarations.
- **Existing guard rails.** The same test reads `theme.tokens.css` as text and enforces per-theme coverage from explicit token lists (`ROOT_REQUIRED_TOKENS`, `THEME_REQUIRED_TOKENS`), which is exactly the hook a new token family extends.
- **Deliberately fixed colors exist.** The mermaid diagram backdrop is pinned to `#ffffff` in every theme (see `openspec/specs/chat-diagrams/spec.md`, "Diagram stays legible in the dark theme"); it must not be folded into the code tokens. `apps/extension` has its own `highlight.js/styles/atom-one-dark.css` import and no e-ink theme.

## Goals / Non-Goals

**Goals:**

- One theme-owned source of truth for every color a code block paints: surface, body text, border, and the full syntax palette.
- E-ink code blocks that read like printed code — light surface, visible border, achromatic syntax differentiation, and a measurable contrast floor.
- Guard rails that fail loudly when a theme omits a code color, instead of silently inheriting another theme's (which is how the e-ink bug happened).
- Zero change to the shared parse markup, so the extension and the mermaid fallback are unaffected by construction.

**Non-Goals:**

- Restyling light and dark beyond turning the block into a single painted surface. Their palette values are carried over byte-for-byte.
- The extension's chat rendering (no e-ink theme there; separate change).
- Inline code chips, the `code-block-header` language label, the inert `code-block-header__copy` span, code-block corner radius, and switching e-ink code to wrapped lines instead of horizontal scroll.
- Deleting the unreferenced `apps/web/app/components/Chat/{ChatBot,BubbleMessage}.vue` (dead code, unrelated to this behavior).

## Decisions

### D1: A `--slax-code-*` token family with the incumbent palette as the light/dark value

Eleven values per theme: surface, body text, border, and eight syntax roles. The eight roles are the incumbent stylesheet's own groupings, so light and dark can carry over byte-for-byte while every value becomes theme-addressable.

| Token | Light / Dark (incumbent) | E-ink |
| --- | --- | --- |
| `--slax-code-bg` | `#282c34` | `#ffffff` |
| `--slax-code-text` | `#abb2bf` | `#000000` |
| `--slax-code-border` | `transparent` | `#cccccc` |
| `--slax-code-comment` | `#5c6370` (italic) | `#666666` (italic) |
| `--slax-code-keyword` | `#c678dd` | `#000000` (bold) |
| `--slax-code-tag` | `#e06c75` | `#333333` |
| `--slax-code-literal` | `#56b6c2` | `#333333` |
| `--slax-code-string` | `#98c379` | `#555555` |
| `--slax-code-number` | `#d19a66` | `#555555` |
| `--slax-code-symbol` | `#61aeee` | `#000000` |
| `--slax-code-builtin` | `#e6c07b` | `#333333` |

`--slax-code-*` goes into the three existing blocks of `apps/web/styles/theme.tokens.css` (declarations only, so the iframe-injection guard keeps passing) and into the two token lists in `tests/theme/tokens.spec.ts`.

E-ink values are hardcoded hexes rather than `var(--slax-surface)` indirection, so the contrast and achromatic assertions can read literal values; a separate assertion pins them equal to `--slax-surface` / `--slax-text` / `--slax-border` so the chat block provably matches the article block.

### D2: Own the stylesheet; keep the syntax highlighter for tokenizing only

A new `apps/web/styles/code-highlight.css` maps the highlighter's class output onto the tokens and reproduces the structural rules the vendor file used to contribute (`pre code.hljs { display: block; overflow-x: auto; padding: 1em }`, `code.hljs` padding, `emphasis` / `strong` / `link` decoration, and the two descendant selectors `meta .hljs-string` and `.hljs-class .hljs-title`). The `atom-one-dark.css` side-effect import is deleted.

Alternatives considered: (a) keep the vendor import and override it from a more specific selector — rejected: it is a specificity war against a file we do not own, it drifts on every highlighter upgrade, and there is nowhere to express a grayscale palette; (b) keep the vendor import for light/dark and add an e-ink-only override block — rejected: it leaves the third-party dark palette as the source of truth and produces exactly the "half fix" trap where a light surface is paired with dark-tuned token colors.

Unmapped classes fall back to the `.hljs` base declaration (`--slax-code-text`), so a future highlighter release that introduces a new class degrades to body text instead of vanishing.

### D3: The block wrapper is the single paint layer

`pre.code-block-wrapper` paints `--slax-code-bg` plus a `1px solid var(--slax-code-border)` border; `code.hljs` inside it is transparent with zero padding, and the wrapper carries the block padding. This satisfies the "one background layer" requirement and removes the light halo that today's wrapper rule produces around the dark body. In light and dark the border resolves to `transparent`, and geometry stays theme-stable because the border is declared unconditionally.

Panel-specific geometry (chat's `padding: 10px 12px`, `border-radius: 6px`, `overflow-x: auto`) stays where it is — a scoped rule legitimately wins over the global stylesheet, and the point of this decision is only that no second *background* layer exists.

Consequence for the language label: `parse.ts` emits `code-block-header__lang` *inside* the wrapper, so the label now sits on the code background instead of the page background. It has no CSS anywhere in the repo, so it would inherit the page body text color — in the light theme `#1a1814` on `#282c34`, roughly 1.27:1 and effectively invisible. The stylesheet therefore colors `.code-block-header` with `--slax-code-text`, and a guard asserts both that rule and the text-on-surface contrast in all three themes. (Caught in review of the first revision, which had left the label untouched.)

Consequence for surfaces that override colors themselves: `MarkdownText.vue` carries a component-scoped blanket `*` rule (specificity 0-3-0) that sets the page text color, which outranks this stylesheet's 0-1-x code rules. That surface therefore has to exclude code-block nodes from its blanket rule — and the exclusion must be wrapped in `:where()`, because a bare `:not()` chain raises the selector to 0-7-0 and then outranks the component's own link rules (`:deep(a)` 0-3-1 / `:deep(a:not(.slax_link))` 0-4-1), stripping `--slax-link` from ordinary links (including the e-ink classic blue). `:where()` contributes no specificity, so the blanket rule keeps its original 0-3-0 weight and both relationships hold. Verified in Chromium against the compiled selector shape and pinned by a guard.

Pairing invariant: code text and code background must always arrive together, because three different rounds of review found the same failure — one of the pair reaching markup without the other. Concretely: the base `.hljs` rule paints `--slax-code-bg` itself (so pre-rendered highlight markup without a wrapper, e.g. inside a feed item, is self-consistent) and the wrapper-scoped rule makes it transparent again inside `pre.code-block-wrapper` (so the one-layer requirement still holds); `.code-block-header` takes the code text color; and a surface that paints every `<pre>` — the chat panel's scoped rule — must also set the code text color *and* the 1px code border, since a bare `<pre>` (raw HTML, mermaid placeholder) carries none of the wrapper classes and, in e-ink, the code surface equals the panel surface (`#ffffff`), so a border-less block would vanish. A guard asserts each half of the pairing.

### D4: `code-highlight.css` is imported from `theme.css`, not from `theme.tokens.css`

`theme.tokens.css` is injected into the reader's iframe preview and shadow roots, where a `.hljs` selector would collide with the original page's own syntax-highlighting styles and would violate the file's "declarations only" guard. `apps/web/styles/theme.css` is the main-site-only global entry (it already holds the `html` / `body` fallbacks and the e-ink wildcard rules), so the class rules are imported there, one line, next to the existing token import.

Alternative: adding the file to `nuxt.config.ts`'s `css:` array — equivalent in effect; the import is preferred because it keeps the injection boundary documented in one place.

### D5: E-ink differentiation by grayscale step, weight and style

Four grays carry the whole palette (`#000000` → `#333333` → `#555555` → `#666666`), each mapping to a coherent band: structure and keywords strongest, then names and constants, then literal values, then comments as the lightest aside. Keywords additionally bold, comments additionally italic — so roles remain distinguishable even where two grays sit one panel level apart. No hue, no alpha: the requirement that each e-ink syntax color be a gray and be opaque is directly testable, and it is what keeps a 16-level panel from needing dithering.

Contrast against `#ffffff` (WCAG 2.1 relative luminance), which sets the floor: `#000000` 21.0:1, `#333333` 12.6:1, `#555555` 7.5:1, `#666666` 5.7:1. `#777777` is 4.48:1 and therefore the first gray that fails the 4.5:1 floor — that is why the lightest permitted value is `#666666`. The floor is asserted for e-ink only: light and dark carry the incumbent palette, which does not meet it (e.g. its comment color is ~2.2:1 on its own surface), and re-authoring those two themes is a separate, user-visible design decision.

### D6: Light and dark keep their values; two accepted visual deltas

Because the eight roles mirror the incumbent groupings, the light and dark palettes are copied, not redesigned, and the surface stays `#282c34`. Two intentional deltas remain in those themes. First, structural: the block now paints one surface, so the wrapper's translucent fill and the highlighted body no longer stack, and the code element no longer adds its own padding inside the wrapper's — insets tighten. Second, the language label: it now sits on the code surface and takes `--slax-code-text`, so in the light theme it becomes light-on-dark instead of dark-on-light. Colors of the surface, body text and syntax roles are unchanged. This is recorded so a reviewer comparing screenshots attributes the diff to geometry and to the label's surface, not to a palette change.

Normalizing light to a paper surface like the article code block was considered and rejected **for this change**: it changes the default theme's appearance for every reader and is a design decision the reported defect did not ask for. The token layer makes it a one-line change later.

### D7: The mermaid backdrop stays outside the token family

The pinned `#ffffff` behind rendered diagrams is intentional and already specified in `chat-diagrams`; it stays hardcoded so a future theme cannot accidentally tint a diagram. The code tokens describe code blocks only.

## Risks / Trade-offs

- Visual regression in light/dark from the collapsed layers → keep every color byte-identical, diff screenshots of the same answer in all three themes, and attribute any residual diff to the documented geometry change (D6).
- The four e-ink grays map to panel levels 3 / 5 / 6 (plus 0) on a 16-level panel → adjacent levels can blur; weight/italic carry the differentiation, and if a real device still reads poorly the palette can be re-tuned inside the same tokens without touching specs.
- A highlighter upgrade adds a class with no token → it inherits the `.hljs` base color (visible, not invisible), and the stylesheet documents the mapping so the gap is obvious in review.
- The guard tests read CSS as text and parse blocks with a regex → keep the existing one-declaration-per-line formatting in `theme.tokens.css`; unusual formatting can defeat `extractBlock`.
- Someone re-adds a vendor highlight stylesheet later → a source guard test fails on `highlight.js/styles/*` imports under `apps/web`.
- Horizontal scrolling remains the only way to read long lines on e-ink (wrapping deferred) → deliberately out of scope; it is a separate readability trade-off that breaks column alignment for everyone else.

## Migration Plan

Frontend-styling only: no data, API, or config migration, and no feature flag. Ship as one PR; the value of the change is verified by rendering the same AI answer in all three themes. Rollback is a straight revert — the previous behavior (vendor import plus the panel's translucent wrapper rule) is exactly what this change removes, with the caveat that reverting also restores the e-ink defect.

## Open Questions

None. The one genuinely deferrable item — e-ink line wrapping — is recorded as a non-goal rather than an open question, because it does not change this approach or the task breakdown.
