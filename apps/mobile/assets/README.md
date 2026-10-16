# Mobile artwork provenance

These assets come from the pinned `slax-reader-client` working tree, including its untracked RSS vectors. `provenance.json` records source paths, content hashes, pixel dimensions, source component references, transformations, and license evidence. The source repository's Apache-2.0 license is preserved in `LICENSE.source`. No asset-specific license notices were found during the source audit; the repository license alone does not independently establish ownership of third-party brand marks.

`index.ts` exports `mobileAssets`, a static Metro registry whose values are React Native `ImageSourcePropType`s. For example, `mobileAssets.bg_login`, `mobileAssets.ic_sm_google`, `mobileAssets.ic_sm_apple`, and `mobileAssets.global_default_avatar` retain the original artwork. `mobileAssetMetadata` records pixel dimensions separately. Components must use their source logical sizes and content scaling; a `null` logical size means the audit did not establish one global display size for that asset.

The original `ic_sm_back.png` is preserved only as provenance. It is intentionally absent from `mobileAssets`: routed pages must use the approved genuine native back control.

The four required source XML vectors are copied without edits into `vectors/`. `convert-vectors.py` converts their audited path geometry and fixed paint into SVG, then PNG at four times the original 24-point dimensions. The generated SVG/PNG files are transformed derivatives; `vector-conversions.json` records source/output hashes and renderer versions. `compose-multiplatform.xml` is inventoried in the source manifest but is unused template artwork and is not copied into runtime assets.

The converter uses already available Node and sharp tooling. It does not install or declare a mobile plugin. Supply paths returned by the workspace-dependency lookup:

```sh
python3 apps/mobile/assets/convert-vectors.py --node "$MOBILE_NODE_RUNTIME" --sharp "$MOBILE_SHARP_ENTRY"
```

Running the converter regenerates the four SVG/PNG assets and conversion metadata. After an intentional source or renderer update, review the outputs and update provenance hashes in the same change. A different renderer version may produce different raster bytes; geometry verification and the native visual comparison remain required.
