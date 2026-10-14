# Web Design Rules

Read the repository root `DESIGN.md` before changing Web UI code.

- Use `styles/theme.tokens.css` for core `--slax-*` runtime values and `app/assets/styles/fork.tokens.css` for Web-only business semantics.
- Treat light, dark, and e-ink as required for new core-shell and reading UI. Check `DESIGN.md` before assuming legacy fork surfaces support every theme.
- Keep selectors and media queries out of `theme.tokens.css`; that file is also injected into article-preview contexts.
- UnoCSS is a selective bridge. Do not add a utility mapping for every token automatically.
- Avoid new raw colors when a matching semantic token exists. Renderer, brand, chart, and documented fixed-profile exceptions remain allowed.
- Do not inject external SVG markup directly. Curate and validate runtime icons, preserve `viewBox`, and apply the accessibility contract in `DESIGN.md`.
- Treat `docs/design/reference/` as visual evidence only. Existing Vue code may contain migration debt and does not override the contract.
