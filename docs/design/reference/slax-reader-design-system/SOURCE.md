# Slax Reader Design System Reference Snapshot

This directory is a non-normative reference snapshot. The normative contract is [`DESIGN.md`](../../../../DESIGN.md).

## Provenance

- Source repository: `https://github.com/unnoo/slax-reader-design-prototypes.git`
- Source commit: `04500203298547b8dd27a251748c2bf598af9d4d`
- Source HTML blob: `6e769fc62462319fefff54e5f7c9a18ae66dd72a`
- Source asset-directory tree: `7a88121ba07827b35a48fe06f6b8290c40e10da1`
- Imported on: `2026-09-29`
- Public repository inclusion: approved by the Slax Reader repository maintainer for this design-governance task
- License for this imported copy: Apache-2.0, consistent with the containing repository
- Original paths:
  - `slax-reader-design-system.html`
  - `SVG 切图汇总/`
- Transformations: none; original file contents and relative layout are preserved
- Integrity record: `manifest.json`

The source repository did not contain a standalone `LICENSE`, `COPYING`, or `NOTICE` file at the imported commit. The maintainer's approval above applies to this exact imported snapshot in the public Slax Reader repository. Preserve this provenance when reusing an asset, and perform a new licensing review before importing a different source commit or third-party asset.

## Limitations

- The icon README describes a historical inventory and is not an exact list of files in this snapshot.
- Some documented icons exist only as inline markup in prototype HTML files outside this imported subset.
- The HTML is written in Chinese and is preserved as source material rather than durable project documentation.
- The HTML imports Google Fonts and contains JavaScript. Opening it may make network requests and execute local page scripts.
- The files in this directory are not approved runtime inputs. SVGs must pass the import boundary in `DESIGN.md` and be curated into an application-owned registry before use.

## Updating the snapshot

1. Select and record an immutable source commit.
2. Review the source diff and the source repository's licensing metadata.
3. Copy the two original paths without flattening or renaming directories.
4. Update the provenance fields in this file and in `tooling/design-reference.mjs`.
5. Run `node tooling/design-reference.mjs --write`.
6. Run `pnpm design:check` and review the generated manifest diff.
