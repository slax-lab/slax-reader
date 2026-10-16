# Reader embed resources

Portable HTML/CSS/bridge source assets and PDF runtime policies used by the Mobile and macOS hosts. The package has no native app dependency. Host transports and lifecycle entry points remain in their applications.

The retained source manifest also records `js/react-native-host.js`; that host-owned file remains under `apps/mobile/assets/embedded/js/`. Mobile's generator resolves that entry locally and resolves portable resources from this package. Preserve the source license, provenance hashes and fixed PDF.js 6.4.299 legacy resource integration.

The Mobile compatibility exports keep existing imports valid. `readerCompatibilityPlugin` loads the same shared source under its original bundler module identity so moving files does not change minified variable allocation or generated PDF bundle bytes. It does not rewrite generated output. New hosts consume shared modules directly and supply their own transport.

## Extraction verification

Under the existing esbuild 0.28.2 toolchain, all four pre/post extraction artifacts are byte-identical:

| Artifact | SHA-256 |
| --- | --- |
| Mobile embedded.generated.ts | fc98ff6fec9269ccb816c4b99ee9a651e85ff9970f432809239bf25ce3476655 |
| PDF bundle.json | dd4b767686faf321121dcf30b9539f3e4b92d62ec61821603684f2fefc30422a |
| PDF manifest.json | 7634d3c81b790a0427da8865caece475c04b0de5319ecfec102b6f5d6ea4885c |
| PDF LICENSES.txt | edd9e65d3c21a4189f4e60e2b1a20d971c6eab3d429190ffbab239a0cd73b59f |

Mobile resource provenance, bridge, PDF source/interop and HTML5 error-readiness tests exercise the extracted code. Native host adapters are unchanged. Browser or native acceptance is not established by the byte comparison alone.
