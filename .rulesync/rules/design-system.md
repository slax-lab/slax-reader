---
root: true
targets: ["*"]
description: "UI design contract entry point and cross-application boundaries"
globs: ["DESIGN.md", "docs/design/**/*", "apps/web/**/*", "apps/extension/**/*"]
---

# UI Design Governance

Before changing UI design, styles, tokens, icons, or Vue presentation in `apps/web` or `apps/extension`, read the root `DESIGN.md`.

- `DESIGN.md` owns semantic intent, application profiles, exceptions, and the design change workflow.
- Runtime token and style files own executable values for their application.
- `docs/design/reference/` is non-normative provenance material and must not be treated as a runtime asset package.
- Keep the Web and Extension profiles separate; do not apply Web theme values to the Extension by default.
- Any visible or accessibility-affecting change follows the repository OpenSpec workflow.

