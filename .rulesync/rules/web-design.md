---
root: false
targets: ["agentsmd"]
description: "Web UI token, theme, icon, and design validation rules"
globs: ["apps/web/**/*"]
agentsmd:
  subprojectPath: "apps/web"
---

# Web Design Rules

Read the repository root `DESIGN.md` before changing Web UI code.

- Use `styles/theme.tokens.css` for core `--slax-*` runtime values and `app/assets/styles/fork.tokens.css` for Web-only business semantics.
- New core-shell and reading UI must support light, dark, and e-ink. Check the theme-support matrix (`DESIGN.md` §4.2, §6) before assuming a legacy fork surface supports every theme.
- Keep selectors and media queries out of `theme.tokens.css`; that file is also injected into article-preview contexts.
- UnoCSS is a selective bridge. Do not add a utility mapping for every token automatically.
- Avoid new raw colors when a matching semantic token exists; renderer, brand, chart, and documented fixed-profile exceptions remain allowed (`DESIGN.md` §5.1–§5.2, §9).
- Do not inject external SVG markup directly. Curate and validate runtime icons, preserve `viewBox`, and apply the accessibility contract in `DESIGN.md` §7.
- Treat `docs/design/reference/` as visual evidence only. Existing Vue code may contain migration debt and does not override the contract.

