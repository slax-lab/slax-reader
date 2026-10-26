---
root: false
targets: ["agentsmd"]
description: "Browser Extension UI profile and design rules"
globs: ["apps/extension/**/*"]
agentsmd:
  subprojectPath: "apps/extension"
---

# Extension Design Rules

Read the repository root `DESIGN.md` before changing Extension UI code.

- The Extension is currently a compact, fixed-dark profile with application-owned styles (`DESIGN.md` §4.3).
- Do not import Web theme tokens or replace Extension values with Web values by default.
- Introduce Extension-owned semantic variables when new colors or dimensions repeat or express a stable role; token selection follows `DESIGN.md` §5.1.
- Preserve compact density, focus visibility, accessible names, and touch/pointer usability; icons and accessibility follow `DESIGN.md` §7.4.
- Do not inject external SVG markup directly. Curate runtime icons and apply the import and accessibility boundaries in `DESIGN.md` §7.3–§7.4.
- Treat `docs/design/reference/` as visual evidence only, not an implementation package.

