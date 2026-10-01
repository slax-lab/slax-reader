# Design Documentation

The repository's only normative UI design contract is [`DESIGN.md`](../../DESIGN.md).

Read it before changing Web or Extension UI code. It defines source ownership, application profiles, token and icon rules, theme coverage, accessibility requirements, exceptions, and the OpenSpec boundary.

## Reference material

`reference/slax-reader-design-system/` is a fixed, non-normative snapshot imported from the sibling design-prototype repository. It preserves the original HTML and asset layout for provenance and visual comparison.

The snapshot is not a runtime asset package. Read its `SOURCE.md` before opening or reusing any content, and run `pnpm design:check` after updating it.

## Maintenance

- Change semantic design decisions in the root `DESIGN.md`.
- Change executable values in the owning application token files.
- Keep Web and Extension profile rules separate.
- Import reference updates from a fixed source commit and regenerate `manifest.json`.
- Use OpenSpec when a change affects rendered UI, accessibility output, or interaction behavior.

