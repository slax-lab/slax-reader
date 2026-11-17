# Proposal

## Why

The change requester wants pages opened before installing Slax Reader to support collection immediately, without a reload. The current install handler resets readiness but does not activate those pages; the existing collection dispatcher only attempts recovery after a user action and readiness timeout.

## What Changes

- On first installation, activate the existing collector in already-open, accessible HTTP(S) tabs without refreshing, navigating, or automatically collecting them.
- Inject the extension's actual built resources with their existing script dependencies and page-versus-Shadow-DOM styling boundaries; reuse an already-ready collector.
- Isolate inaccessible or closed tabs so one failed activation does not stop other tabs or installation setup.
- Provide the HTTP(S) host access required for proactive scripting, while preserving browser-managed site restrictions and the existing file/PDF recovery flow. Inspect generated manifests rather than assuming declarative content-script matches grant programmatic access.
- Add focused regression coverage and exercise a genuine first installation after opening a page, followed by successful collection without reloading that page.

## Capabilities

### New Capabilities

- `extension-install-activation`: First-install activation of existing web tabs with existing collection, authentication, resource, and browser-permission boundaries preserved.

### Modified Capabilities

None. Existing PDF-saving and input/overlay requirements remain unchanged.

## Impact

- Background installation lifecycle and browser service in `apps/extension/src/entrypoints/background/`.
- Manifest generation in `apps/extension/wxt.config.ts`, including HTTP(S) host permissions where absent from the final manifest. Proactive access is broader than the current explicit Slax-host declarations, even though the collector already declares `<all_urls>`; review this security implication explicitly.
- Existing content readiness protocol, WXT Shadow DOM styling, and development-only vendor prerequisites are reused, not redesigned.
- Extension Vitest coverage, browser verification, and `docs/extension/development.md` smoke instructions. No new dependencies, backend changes, or API contracts.
- Extension version decision is required before implementation handoff under repository policy; no version change is made in this planning phase.

## Non-goals

- Reinjecting all tabs on updates, browser upgrades, worker restarts, or ordinary extension reloads.
- New collection UI, automatic bookmark creation, automatic login, or bypassing browser restrictions.
- Proactive activation of local files, browser pages, extension pages, or unsupported schemes; existing explicit-action PDF behavior remains intact.
- A general-purpose manifest matcher, persistent retry scheduler, or new navigation/race state machine.

## Review status

The change requester approved implementation on 2026-11-16 with “按方案实现”. They subsequently explicitly approved a separate temporary Chrome profile, required deleting it after testing, and supplied the test API and session for real collection verification. The approved isolated test completed and profile deletion was independently checked; outcomes are recorded in `validation.md` without credentials. On 2026-11-16, the requester also explicitly confirmed that prior hands-on acceptance was complete, clarified that this change does not alter the UI, approved Extension version 1.16.4, and authorized opening the task PR against dev. Store publication, merge, and archive are not authorized.
