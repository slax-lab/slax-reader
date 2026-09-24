# Tasks

## 1. Parse layer (packages/frontend-utils)

- [x] 1.1 In `packages/frontend-utils/src/parse.ts`, add a raw-source fence pre-scan that downgrades unclosed ```mermaid opening fences before `mdi.render` (per design D2), and make `highlight()` emit a placeholder `<div class="mermaid-placeholder">` with the HTML-escaped mermaid source as text content for closed mermaid fences. Verify with new vitest cases (run under `apps/web`'s vitest setup, since `frontend-utils` has none): closed fence → placeholder survives `DOMPurify.sanitize`; unclosed fence → plain code block; non-mermaid languages unchanged.
- [x] 1.2 Export the existing `highlightBlock` helper (or an equivalent code-block renderer) from the parse module for reuse by the failure fallback. Verify the module's existing consumers still typecheck (`pnpm --filter @commons/frontend-utils` build/type check as applicable).

## 2. Hydration helper (packages/frontend-utils)

- [x] 2.1 Add `hydrateMermaidDiagrams(rootEl)` to `frontend-utils`: scan for `.mermaid-placeholder`, dynamically `import('mermaid')` (initialized with `securityLevel: 'strict'`), render each placeholder's source, DOMPurify-sanitize the SVG, and replace the placeholder with it; maintain the module-level result cache keyed by source (design D3). Verify with vitest: placeholder replaced by SVG; second hydration of same source uses cache (mock `mermaid.render`, assert single call).
- [x] 2.2 Implement the failure fallback: when `mermaid.render` throws, replace the placeholder with the code-block markup from 1.2 plus an error-notice element, and cache the failure (design D4). Verify with vitest: mocked render throw → code block + visible error notice, no exception propagates.

## 3. Web surfaces (apps/web)

- [x] 3.1 Verify the web production build keeps mermaid out of the initial bundle: mermaid is declared in `packages/frontend-utils` dependencies and only dynamic-imported by the hydration helper, so `pnpm web -- build` should emit mermaid as a separate lazy chunk (inspect build output).
- [ ] 3.2 Wire hydration into the web chat bubble path: call `hydrateMermaidDiagrams` in `nextTick` after every `v-html` update for assistant messages in `Snapshot/SnapshotChatPanel.vue` (the only live web chat component), following the `handleAnchors` pattern in `MarkdownText.vue`. (Note: `apps/web/app/components/Chat/ChatBot.vue` + `Chat/BubbleMessage.vue` are unreferenced dead code — do not wire them; an earlier iteration did and it was reverted.) Verify manually on both `pages/b/[id]` (reader) and `pages/s/[id]` (shared snapshot): a streamed mermaid answer shows a code block mid-stream and a diagram after the fence closes. (Implementation done; manual verification covered by 5.2.)
- [x] 3.4 In-bubble sizing: rendered SVG scales to bubble width (`max-width: 100%; height: auto`). Verify a wide flowchart fits the bubble without horizontal scroll.
- [x] 3.5 Add a full-view overlay component (new; no existing viewer to reuse): click a rendered diagram to open, show the cached SVG at natural size, support zoom and pan, and dismiss. Verify click → overlay → zoom/pan → close works.

## 4. Prompt contract (apps/api)

- [x] 4.1 Add the diagram-format line to the chat rules in `apps/api/src/const/prompt.ts` so it applies to both `chatMobileRules` and `chatDesktopRules` paths of `buildChatSystemInstruction`: when the user explicitly asks for a diagram or chart, express it as a ```mermaid fenced code block. Verify by inspecting the assembled system instruction for both platforms (unit test or direct assertion in existing API test setup).

## 5. Verification

- [x] 5.1 Run `pnpm web -- test`, web typecheck and lint in the worktree; all green. Run `pnpm extension -- test` / typecheck as a regression check (no extension changes remain in this change).
- [ ] 5.2 Local end-to-end: the worktree's `deploy/local` gitignored files are symlinked from the main checkout (already done); keep the main checkout's Docker infrastructure running, stop the main checkout's dev servers, then run `pnpm api -- dev` + `pnpm web -- dev` from the worktree. In the local reader, ask the AI to draw a swimlane diagram of a complex article and confirm: code block mid-stream → rendered diagram (with node labels) at fence close → scaled to bubble → click opens full view with zoom/pan. Repeat on `pages/s/[id]` (shared snapshot page).
