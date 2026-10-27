# Mobile Engineering Rules

Apply these boundaries to new and changed code; they are the refactoring target, not a claim that existing migration code already conforms. Preserve behavior during extraction and keep approved OpenSpec tasks and remaining acceptance limits explicit.

## Responsibilities and dependencies

- Keep `src/App.tsx`, providers, and `src/screens` focused on startup and route composition. Screens assemble feature state and explicit-prop UI rather than becoming service owners.
- Dependency direction is app composition → feature controllers/hooks → typed domain/data ports; infrastructure and native adapters implement those ports. Wire adapters at composition boundaries, not inside presentation. Shared UI must not import screens or start account services; domain policies must remain independent of React Native and adapters.
- Split by cohesive responsibility: feature state, presentation, domain policy, transport/storage, and native host integration. Reader document/annotation/AI/overlay state, host geometry, and HTML/PDF protocols have separate owners. Prefer readable small modules; do not replace a large screen with a mega-hook, compressed JSX, or arbitrary forwarding files.
- Presentation must not execute SQL, perform `fetch` or filesystem I/O, or own account transitions. Keep API transport/endpoints, repository/watch infrastructure, and cache scheduling behind typed boundaries; remove temporary facades once their callers migrate.
- Every async operation, watcher, timer, subscription, and animation has one lifecycle owner. Scope work to the active account, API origin, runtime generation, and document where applicable; cancel on replacement/disposal and discard stale success and failure results. Preserve queued writes and never log credentials or document contents.

## Startup and credentials

- Route selection waits only for local logged-in state: show Login or the authenticated shell immediately after that state is known. Separate presentation readiness, verified data readiness, and network readiness.
- Database ownership/migration verification gates data access only. Hydrate cached content only after admission; show localized loading/recovery in the shell when admission is delayed or fails. Never reveal unverified or cross-account data.
- Initialize runtime/database, refresh main credentials, and acquire/connect PowerSync asynchronously without a global blank startup barrier. Protected API/PDF calls await valid main credentials; sync acquisition/connection awaits its own credential readiness. Local login does not authorize stale network dispatch.
- Coalesce refresh by active owner, honor actual deadlines and signed expiry, bound retries, and reject late results after sign-out/account/origin replacement. Offline failures must retain safe local UI, admitted cached data, and pending uploads.

## Reader and native boundaries

- Reuse existing PDF APIs: `/v1/bookmark/metadata` returns the descriptor under `data.pdf`; `/v1/bookmark/pdf` supplies authenticated bytes. Do not invent replacement interfaces. Validate Range status, bounds, total size, and payload length; support absent ETag, reject contradictory identity when supplied, and mark the cache complete only when the full file's size matches its unchanged descriptor identity. Do not compute SHA-256 or other content hashes on runtime paths; use primary keys for identity.
- Use locally bundled PDF.js and the existing HTML Reader's platform scroll model: one WK scroll owner with measured native header/insets on iOS; one outer native scroller with the header and document-height, non-scrolling WebView on Android. Use the real host viewport for virtualization and document-bound coordinates for marks/restoration.
- Fit PDF pages to Reader width by default. PDFs follow the ordinary automatic article-cache policy; do not add a standalone PDF offline-download action, PDF-specific page/zoom/Fit chrome, AI-preparation notices, offline/completion badges, or partial-cache rows. Keep genuine failures in normal Reader retry UI and notes in existing app presentation.
- Keep platform-specific behavior in app-owned native modules/adapters and config plugins. Never patch installed dependencies or hand-edit generated assets/projects as a substitute for their source/generator. Preserve Expo/React Navigation and the installed native stack unless an approved change requires otherwise.

## Motion and interaction

- Reuse installed Reanimated/Gesture Handler or supported native-driver animation paths. Keep scroll/gesture transforms on the native/UI execution path; never drive frames through React state or rebuild PDF layout per frame.
- Motion must use measured geometry, be interruptible/cancellable, and honor reduced motion. Preserve hit testing, accessibility, stationary backdrops, keyboard avoidance, dismissal completion, and cancelled native-back transitions. Centralize reusable policies without adding an animation library by default.

## Verification and generated guidance

- Extend the existing unit/mounted-host suites for real extracted policies/controllers: cancellation, replacement races, permissions, credential readiness, geometry, subscriptions, and interrupted motion. Mock external boundaries, not the behavior under test; source-text checks alone do not prove functionality.
- Unit/host/browser checks do not establish native acceptance. Exercise original scenarios on affected Android/iOS targets, including cold process relaunch, offline reading, selection, scrolling, and keyboard/gesture interruption. Claim performance only with measured Release profiles; record skips, limitations, and live-service authorization separately. Record native acceptance results in `openspec/changes/<change-id>/validation.md` like any other verification evidence (see "Definition of Done" in the root rules).
- From the repository root run `pnpm mobile -- check` and `pnpm mobile -- bundle`; use `pnpm mobile -- test:native-resources`, `pnpm mobile -- build:android`, and `pnpm mobile -- build:ios` for affected native boundaries. These checks do not authorize deployment or release.
- Follow the latest user-authorized model restriction when executing or delegating functional tests, including fast-model-only instructions; do not reuse historical no-test exceptions. Rules generation/drift validation is not functional test execution.
- Edit `.rulesync/rules/mobile-architecture.md`, not generated `apps/mobile/AGENTS.md`. Run `pnpm agent:sync` and `pnpm exec rulesync generate --check`; nested generated guidance must remain covered by the drift hook. Run `pnpm exec openspec validate --all --strict` after spec/change edits and `git diff --check` for the final diff.

## Task-owned build cleanup

- Record validation results and deliver requested outputs before removing task-owned build caches/artifacts. Clean them after final delivery; never remove an output while another task or delivery still needs it.
- Limit cleanup to identified outputs of this task's builds (for example its dedicated DerivedData, native build directories, bundle output, and disposable test caches). Do not delete global/shared caches broadly or erase another task's artifacts to recover disk space.
- Preserve source, configuration, credentials, dependency state needed by active work, pending user data/uploads, migration recovery state, and required evidence. Retain requested packages and necessary diagnostic/acceptance outputs until delivered; report any retained outputs or cleanup that must wait.
