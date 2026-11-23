# Design

## Context

See `proposal.md` for motivation and scope. Web's `AddUrlTopModal.vue` owns URL submission and PDF selection, currently clearing one input when the other changes. `RssPanel.vue` owns a separate add/edit form. Mobile's `LinkInputDialog.tsx` serves both acquisition and bookmark-title editing; the PDF flow waits for native modal dismissal before showing the system picker, and `RssFeed.tsx` owns a separate bottom-sheet editor.

The change requester specifically requires a demo produced by modifying the real components in a worktree. A standalone HTML page, copied mock app, or browser reconstruction of the native app is not the deliverable. The latest inspected `origin/dev` baseline has no differences in these affected components or the governing design contract compared with the initial exploration.

## Goals / Non-Goals

**Goals:**
- Reuse existing surfaces and services, with one add-session owner and explicit modes.
- Preserve the original Web modal and Mobile centered compact dialog presentation.
- Exercise the changed Web component in the running Web application and the changed React Native component on an available native target.

**Non-Goals:**
- No new theme, bottom sheet, animation library, backend API, format support, remote feed detection, or unrelated reader redesign.
- No changes to title editing, RSS rename/remove semantics, clipboard permissions, or acquisition authorization.
- No commit, push, release, or production acceptance during demo preparation.

## Decisions

### Preserve each application's actual dialog

Web retains the existing 480px modal width, 24px padding, semantic theme tokens, typography, close control, and footer alignment. Mobile retains `SourceDialog` compact presentation: centered placement, existing 12-point radius, 20-point horizontal and 24-point vertical content padding, existing title/input typography and full-width action. Add only an internal tab strip, active panel, and contextual hint. Labels remain localized, with compact URL/Feed/File labels in English and Link/RSS subscription/File equivalents in Chinese.

The rejected alternative is a new shared visual shell or a standalone demo application. Only the interaction policy is common; profile-specific rendering stays application-owned.

### Keep business operations separate

Web continues through its existing local-first/save-guard/first-party fork paths for URL, existing subscription action for Feed, and existing upload endpoint for File. Move only the RSS add-form presentation out of the panel as needed; do not instantiate a second RSS poll/list owner to render a tab. Keep existing RSS editing separate.

Mobile composes a dedicated acquisition surface at the Library boundary rather than enabling tabs in every use of `LinkInputDialog`. Reuse the existing RSS controller and PDF native/API adapters. Extract file-draft and upload ownership from the dialog presentation only as far as required for one open session; do not erase temporary files merely because their panel becomes inactive. Leave title editing as-is.

### One session, explicit mode, independent auxiliary drafts

A session owns `mode`, the common URL/Feed address, the optional feed name, file selection, per-mode errors, and submission state. A tab switch does not submit or clear drafts. A new ordinary add session starts at URL; an RSS-specific entry starts at Feed if enabled. Closing the session resets drafts and releases owned file resources. During an in-flight submit, prevent competing tab submissions using the existing busy affordance.

Switching to File dismisses the keyboard but does not open the picker. The existing native modal dismissal/picker ordering remains intact. Canceling a picker restores the same session. The design does not replace native modal lifecycle handling with guessed delays.

### Gate acquisition with confirmed Labs state

Use the current account's existing loaded Labs state for tab visibility and candidate evaluation. Do not alter the existing RSS list's offline/local-presence fallback, which serves a different purpose. Pending state leaves URL usable. A confirmed disabled response removes the affected mode and returns to URL without submitting. Server-side authorization remains unchanged.

### Use deterministic local candidate hints

Keep a small pure policy shared through an existing package consumed by both clients, with no new dependency. Parse a valid HTTP(S) URL, inspect path segments, conventional feed basenames and rss/atom suffixes, and bounded query keys such as feed/format/type with explicit feed values. Do not search arbitrary query text or fragments. Use a comparison copy only; preserve the actual submitted address and query values.

The UI runs the policy only while RSS is enabled and URL is active. The localized hint offers Switch to Feed and Keep as URL. Dismissal is scoped to the unchanged address for the open session. Existing clipboard prefill is treated like any other input. No fetch occurs until an explicit existing submit action.

### Demo uses real application routes

Use the project's documented Web development command and existing native fixture/development facilities. Controlled fixtures may supply Labs and service results where existing harnesses support them, but must render the actual changed components. Show ordinary URL, likely-feed hint, Feed form, File selection, errors/busy states, and both feature-off combinations. Do not touch the current checkout's credentials, uncommitted files, or running services. Record actual runs and limitations; a browser rendering is not native acceptance.

## Risks / Trade-offs

- Heuristics can miss opaque feed addresses or identify a non-feed path → call the result possible, retain URL saving, and rely on existing backend Feed validation.
- Native file selection can dismiss and recreate modal presentation → preserve the existing lifecycle ordering while keeping session state outside the active panel.
- Existing RSS add state is owned by its list surface → reuse its controller/composable action rather than creating another polling owner.
- A fresh worktree may lack installed dependencies or native build artifacts → use documented setup commands and existing isolated fixture tooling; report a genuine native-run blocker rather than substitute a lookalike.
- Layout changes affect keyboard and narrow-screen access → verify Web desktop/768px/320px and native keyboard-visible states, keeping source font and spacing semantics.

## Migration Plan

No data or server migration is needed. Keep changes confined to `feat/add-content-tabs`. After proposal review, prepare the real-component demo and collect visual feedback before treating the design as approved for completion. Finish regression checks and human hands-on acceptance before any PR. Confirm the Mobile version decision before eventual implementation handoff. Reverting the isolated UI/policy change restores the old entry flow without changing saved content.
