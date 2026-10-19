# Desktop release operations

Public distribution activation and minimum supported macOS are deferred section 9 decisions. This document prepares the tooling; it does not select those values or authorize a public release. PR CI creates unsigned host artifacts only and has no signing/notarization credentials.

| Branch channel | Bundle identifier | Product | Tag namespace |
| --- | --- | --- | --- |
| local (no release) | app.slax.reader.mac.local | Slax Reader Local | none |
| preview / dev | app.slax.reader.mac.preview | Slax Reader Preview | desktop-dev-v* |
| beta | app.slax.reader.mac.beta | Slax Reader Beta | desktop-beta-v* |
| main | app.slax.reader.mac | Slax Reader | desktop-v* |

Build from a reviewed, tested commit with a clean frozen dependency installation. Keep Desktop assets separate from CLI tags, archives and updater endpoints. Universal builds include arm64 and x86_64; a host build is for local review, not evidence for both architectures.

```sh
pnpm desktop -- bundle --env beta
pnpm desktop -- release sign --env beta --app /absolute/SlaxReader.app
pnpm desktop -- release notarize --env beta --app /absolute/SlaxReader.app
pnpm desktop -- release prepare-update --env beta --app /absolute/SlaxReader.app
```

Release commands fail closed without `SLAX_DESKTOP_DISTRIBUTION_APPROVED=true`, the approved `SLAX_DESKTOP_MINIMUM_MACOS`, a Developer ID `SLAX_DESKTOP_SIGNING_IDENTITY` and a Keychain `SLAX_DESKTOP_NOTARY_PROFILE`. Build with the approved minimum and verify the Info.plist before signing. Keep certificates, Apple credentials and updater private keys operator-managed; never commit or print their values. The Tauri signer consumes its standard operator environment. This tool writes only the resulting archive signature and public metadata.

Local builds cannot be released and never enable the updater. Remote builds use the explicit environment profile documented in [DEVELOPMENT.md](DEVELOPMENT.md). The updater is inactive without compile-time `SLAX_DESKTOP_UPDATE_ENDPOINT` and channel-specific `SLAX_DESKTOP_UPDATE_PUBLIC_KEY`. HTTPS is required. Update metadata must carry matching `environment`, `channel` and `identifier`; the artifact URL must share the configured host and begin `/macos/<channel>/`. The signed artifact is verified by the pinned updater before installation, then the core shuts down before restart. Use different verification keys per channel. No entitlement is accepted from updater/browser return data.

After notarization, record codesign verification, stapling assessment, universal `lipo -archs`, exact archive/bundle SHA-256, commit, OS, channel and manual acceptance. Publishing/uploading is a separate explicit operation; these commands do not create a public GitHub Release. Roll back by withdrawing the affected update or disabling desktop entry while preserving account data and additive authentication tables.
