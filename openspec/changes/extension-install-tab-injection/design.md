# Design

## Context

See `proposal.md` for motivation and `specs/extension-install-activation/spec.md` for the behavior contract.

Observed implementation:

- `src/entrypoints/background/index.ts:339` handles installation by resetting content readiness, configuring badges and menus, calibrating locale, and then handling onboarding/session synchronization. It does not activate existing tabs.
- `src/entrypoints/background/browserService.ts:174` handles an explicit collection action. Its bounded readiness wait can fall back to injecting `/content-scripts/content.js`; that recovery currently depends on user invocation and does not proactively prepare old tabs.
- `src/entrypoints/content/index.ts` declares `<all_urls>`, `document_idle`, and `cssInjectionMode: 'ui'`. It mounts the existing collector/sidebar in Shadow DOM and implements `ContentScriptReady` probes and announcements.
- `wxt.config.ts` also declares page-level `content-scripts/mark.css`. `vendor.config.ts` prepends `vendor.js` in builds using development vendor externalization, before the main content bundle.
- The explicit manifest configuration includes `scripting`, `tabs`, `activeTab`, Slax application host permissions, and file access. Programmatic proactive injection must have effective HTTP(S) host permissions without relying on an action grant. Inspect the final generated manifest during implementation.
- Existing Vitest readiness tests cover live probes, timeouts, logged-out behavior, and PDF routing. Standard verification commands and browser loading guidance are in `docs/extension/development.md`.

## Goals / Non-Goals

**Goals:**

- Add a single first-install activation pass using the existing background service, resource bundle, and readiness protocol.
- Keep individual tab failures local and avoid coupling activation to login or remote synchronization.
- Test the actual installed artifact and original pre-install page, not just a mocked event callback.

**Non-Goals:**

- No new dependency, persistent retry queue, arbitrary manifest interpreter, or navigation state machine.
- No redesign of collection components, new styles, authentication changes, or expanded PDF behavior.
- No promise of activating discarded/unloaded tabs or inaccessible browser-managed documents; normal page loading and explicit-action recovery remain available.

## Decisions

### 1. Invoke one isolated activation pass for `reason === 'install'`

Add a browser-service operation and invoke it after `resetContentScripts()` has finished, before session-dependent work. Start it independently from other install setup, attach an explicit rejection handler, and retain per-tab error isolation so a failed enumeration/injection cannot suppress menus, onboarding, or synchronization. Do not gate activation on authentication.

Query HTTP(S) tabs, require a valid tab ID and URL, and target the top frame only. Do not switch, reload, or navigate tabs. Use concurrent per-tab operations with contained failures; do not add retries or persistent progress.

Alternative rejected: rely only on the current click-triggered injection. It does not provide the requested proactive availability and incurs the existing readiness timeout. Bulk activation on updates is intentionally excluded.

### 2. Use the existing readiness probe and narrow resource wiring

Probe `ContentScriptReady` for each candidate. Only an explicit `ready: true` acknowledgement is proof of readiness; `undefined` is not. Reuse a responsive collector and its readiness bookkeeping. Otherwise inject the actual content assets, then let the existing content announcement establish readiness; successful script execution alone is not readiness.

Read the bundled manifest to resolve the current known resource declarations rather than maintaining a second independent asset list: the existing `<all_urls>` vendor entry when present, the main content entry, and page-level CSS. Limit selection to these known collector resources, not every script in the manifest. Preserve prerequisite order: optional vendor, then collector. Insert declared page CSS before the collector. Leave Shadow DOM CSS under WXT's UI mechanism; do not insert the collector's UI stylesheet into the host document.

Keep explicit-action recovery intact. Only share a small resource-injection helper with that path if necessary to prevent vendor/style drift, and preserve its current readiness and PDF behavior. Do not replace the existing waits or add a new global singleton/state machine without a reproduced defect requiring it.

Alternative rejected: copy the example's Gmail files or insert every generated stylesheet globally. Those paths are not this extension's resources, and global UI CSS would break the existing isolation boundary.

### 3. Declare only the proactive host coverage needed

Ensure generated manifests contain `http://*/*` and `https://*/*` host coverage for programmatic activation, adding these patterns to `wxt.config.ts` if they are not already generated. Preserve existing environment-specific declarations and file behavior. Do not request optional access at install time or enable file/incognito/site access settings.

The existing `activeTab` permission is not a background installation grant. Broad HTTP(S) host coverage also broadens the origins accessible to already-declared host-sensitive APIs such as cookies; the implementation must not add unrelated access or network listeners. Existing session-cookie and web-request origin filters stay unchanged. Review permission differences in the generated artifact explicitly.

Alternative rejected: catch permission failures on every ordinary site and declare success. That would leave the requested feature ineffective. If the change requester rejects broader host coverage, revise the proposal rather than silently degrading to the current click-only behavior.

### 4. Preserve browser denials as ordinary per-tab outcomes

Skip non-HTTP(S) schemes. Contain protected HTTPS pages, withheld site access, and tabs closing during injection with per-tab rejection handling. Do not build a browser-store hostname denylist when the scripting API already enforces those restrictions. Do not log page URLs, page content, or raw errors that may contain private URLs.

This is required failure isolation for common open-tab sets, not speculative security hardening.

### 5. Verify installation before user-triggered recovery can hide failures

Use the requested Kimi Code Desktop built-in browser tooling for interactive verification and first confirm that it can install the regular unpacked Chromium extension. If extension installation is unsupported there, report that specific blocker and seek an approved extension-capable test environment; do not silently substitute the user's Chrome profile. Existing `playwright-core` fixtures can supplement automated regression coverage but do not replace the requested interactive exercise.

The decisive scenario is:

1. In a disposable/test profile without this extension, open a non-sensitive ordinary HTTP(S) article and keep its document alive. Record a document marker or navigation timing to prove it was not reloaded. Also open a restricted page.
2. Load the freshly built regular unpacked extension, causing the genuine first-install event. Do not simulate the event, merely reload an existing install, or navigate the article after installation.
3. Before clicking any collection action, confirm the original page responds to the collector probe, has one collection host/sidebar, and has the expected styles. This proves proactive activation rather than action-time recovery.
4. Invoke a real existing collection action, observe normal feedback, and confirm the saved bookmark in the real configured Slax service. Use an authorized test session and non-sensitive article; do not inspect or log credentials.
5. Confirm the original document marker/navigation timing is unchanged, no duplicate hosts exist, and the restricted page did not block the ordinary page.
6. Check a newly opened page, unauthenticated collection, and existing PDF/file-access fallback. Record exact coverage and gaps; mock API success is not real backend acceptance.

## Risks / Trade-offs

- [HTTP(S) host access expands privileges] → Declare the change visibly, inspect built permission differences, preserve existing narrow cookie/request use, and require proposal review before implementation. Do not promise unchanged browser permission prompts without testing.
- [Opening many old pages initializes the existing collector on each] → Keep the pass installation-only and reuse live collectors; no polling, recurring scan, or automatic saves.
- [Development and packaged artifacts have different prerequisites] → Inspect and test vendor-present and vendor-absent resources; verify normal packaging, not only an instrumented fixture.
- [Browser restrictions or missing test authentication block complete verification] → Report the concrete unverified requirement; do not label injection-only or mocked-backend checks as successful end-to-end collection.
- [A tab navigates while work is in flight] → Rely on browser targeting and existing content lifecycle first. If a concrete duplicate or stale-document failure is reproduced, present the failure and smallest correction before adding extra synchronization.

## Migration Plan

No data migration. Implement after proposal approval, build normally, and verify in an isolated test profile. Installation on an existing personal profile is not required and must not remove its extension data. A release rollback removes the new install hook and any newly introduced host declarations; existing bookmark data and ordinary content loading remain unchanged.

Before code handoff, obtain the required Extension version decision. Record implementation evidence and any human hands-on acceptance in `validation.md`; do not open a PR or archive this change during proposal preparation.

## Assumptions

- First install means `reason === 'install'`, not update or development reload.
- The requested websites are loaded HTTP(S) pages; proactive file/PDF activation is excluded.
- No new UI or structural interaction design is needed, so a requirements-discovery demo is not necessary for this narrowly scoped lifecycle change.
