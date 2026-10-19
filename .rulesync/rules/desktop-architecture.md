---
root: false
targets: ["agentsmd"]
description: "macOS desktop core, presentation, native integration and reader isolation"
globs: ["apps/desktop/**/*"]
agentsmd:
  subprojectPath: "apps/desktop"
---

# Desktop Engineering Rules

- This application targets macOS. Read root `DESIGN.md` before presentation changes. Desktop runtime tokens belong to `src/styles/tokens.css`; article/PDF documents retain a fixed light renderer profile.
- Vue components and Pinia stores own presentation and interaction. All HTTP, synchronization, SQL, credentials, cache files and account admission belong to the Tauri-independent `crates/slax-core`. The shell implements native ports and adapts typed commands, Channels and binary responses. Never add fetch, SQL or unrestricted filesystem/shell plugins to presentation.
- Generate IPC types from Rust DTOs with `pnpm desktop -- ipc:generate`. Commit generated types with the source. Do not hand-edit them or expose credential/verifier/code fields through a serializable UI DTO.
- Every operation belongs to an account generation and, where applicable, a live document capability. Acquire account/file leases, cancel on retirement and recheck before publication or disk writes. Sign-out preserves pending changes unless the user explicitly chooses discard; window hiding preserves background ownership.
- Consume the pinned, already-fixed synchronization dependency unchanged. PowerSync repair, forks, patches, upstream work and proof A are outside the approved desktop scope. Preserve version 2 parameters and existing stream names; honor actual credential expiry.
- Article HTML is untrusted. Sanitize it in Rust and keep the opaque sandbox (`allow-scripts` without `allow-same-origin`). Only bundled trusted bridge code executes. Article frames receive no main-webview IPC capability. Check source window, channel, page ID, bounded schema and request identity before acting on messages.
- Resource handles are account/document scoped, revocable capabilities. Never accept arbitrary paths or network destinations as resource handles. Only admitted image MIME types may be returned; reject private-network resources and redirects. PDF document bytes cross IPC as binary ArrayBuffers, never base64.
- Persist credentials through the Rust credential port in the environment/origin-scoped app directory (0700 directory, atomic 0600 files). The user explicitly removed the system Keychain requirement; credentials must never enter Vue, IPC DTOs or logs.
- Use native predefined Edit commands, overlay traffic lights, system sidebar material, system accessibility/network/sleep observation, hide-on-close and orderly explicit quit. Keep native material optionality separate from a claim of installed acceptance.
- Root commands are `pnpm desktop -- dev[:local|preview|beta|main]` (default local), `build[:local|preview|beta|main]` (default main), and `typecheck|test|test:core|check|bundle`. Signing, notarization, updater activation and public release require explicit approved release configuration. Minimum macOS and distribution activation remain deferred section 9 decisions.
- Unit/browser checks do not establish native acceptance. Record the actual build, OS, architecture and observed cases in `docs/desktop/acceptance.md`. Keep unexecuted cases and service prerequisites explicit. The current user requested a packaged code review before expanding optimization and unit tests.
