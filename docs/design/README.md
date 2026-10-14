# Design Documentation

The repository's only normative UI design contract is [`DESIGN.md`](../../DESIGN.md).

Read it before changing Web or Extension UI code. It defines source ownership, application profiles, token and icon rules, theme coverage, accessibility requirements, exceptions, and the OpenSpec boundary.

## Reference material

`reference/slax-reader-design-system/` is a fixed, non-normative snapshot imported from the sibling design-prototype repository. It preserves the original HTML and asset layout for provenance and visual comparison.

The snapshot is not a runtime asset package. Read its `SOURCE.md` before opening or reusing any content, and run `pnpm design:check` after updating it.

The [design-system backlog](backlog.md) records bounded follow-up work for reusable Web icons and legacy theme-token debt. It does not require removing every local SVG or grant implementation scope without an OpenSpec change.

## Completed design-system work

The design contract, reference snapshot, and approved Web icon migrations form the completed foundation. The [living runtime icon specification](../../openspec/specs/runtime-icon-registry/spec.md) records the merged behavior.

- [Initial registry and migration matrix](../../openspec/changes/archive/2026-10-09-runtime-icon-registry/migration-matrix.md).
- [Web control migration and verification record](../../openspec/changes/archive/2026-10-14-web-icon-registry-followup/migration-matrix.md) from PR #186.
- [Accessibility, default-size, and backlog follow-ups](../../openspec/changes/archive/2026-10-14-design-system-followups/proposal.md) from PR #188.

Remaining icon migrations and theme-token debt stay in the backlog and can be addressed alongside relevant feature work.

## Maintenance

- Change semantic design decisions in the root `DESIGN.md`.
- Change executable values in the owning application token files.
- Keep Web and Extension profile rules separate.
- Import reference updates from a fixed source commit and regenerate `manifest.json`.
- Keep deferred icon and theme-token work in [backlog.md](backlog.md), with explicit exclusions and a definition of done.
- Use OpenSpec when a change affects rendered UI, accessibility output, or interaction behavior.
