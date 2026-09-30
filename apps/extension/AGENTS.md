# Extension Design Rules

Read the repository root `DESIGN.md` before changing Extension UI code.

- The Extension is currently a compact, fixed-dark profile with application-owned styles.
- Do not import Web theme tokens or replace Extension values with Web values by default.
- Introduce Extension-owned semantic variables when new colors or dimensions repeat or express a stable role.
- Preserve compact density, focus visibility, accessible names, and touch/pointer usability.
- Do not inject external SVG markup directly. Curate runtime icons and apply the import and accessibility boundaries in `DESIGN.md`.
- Treat `docs/design/reference/` as visual evidence only, not an implementation package.
