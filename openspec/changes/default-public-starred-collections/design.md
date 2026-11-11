# Design

## Context

See `proposal.md` for the product decision and `specs/starred-collection-sharing/spec.md` for the behavior contract.

The current implementation creates a collection only through `share_collect` enablement. `GET /v1/collection/mine` returns `null` when no row exists, and the Web starred surface hides the setup entry below 10 stars and on narrow viewports. Existing collections use `status=1` for open and `status=0` for closed; their current visibility, public codes, and subscription relationships must remain intact.

Collection counters are maintained by database triggers. Inserting a collection initializes its stats from current bookmarks, so a bulk insert for every historical account would also perform per-account star and subscriber calculations. The sitemap already joins these stats but currently requires `starred_count >= 10`. The public collection page already has an empty state.

Web starring has REST and local-first paths in bookmark cells, the article detail composable, and `/b/[id]`. The existing Toast component supports a non-blocking action. Owner collection information is cached by `useShareCollectInfo`.

## Goals / Non-Goals

**Goals:**

- Make collection creation idempotent, stable, and independent of the old enablement UI.
- Preserve every existing collection's open or closed status during rollout and subsequent provisioning.
- Preserve old-client close/reopen compatibility while removing enablement from the new Web experience.
- Show the first-star cue on the user's first star without coupling its success to starring.
- Avoid a bulk collection insert and its associated stats-trigger workload.

**Non-Goals:**

- Changing bookmark star persistence, PowerSync write behavior, public collection subscriptions, or snapshot access rules.
- Backfilling collection rows for dormant accounts that have no collection and have not authenticated since rollout.
- Changing the visibility of any existing collection during rollout or ordinary provisioning.
- Removing the existing visibility endpoints used by older clients for close/reopen.
- Adding native-mobile collection management or per-bookmark visibility controls.
- Persisting first-star cue state on the server to deduplicate it across browsers or devices.
- Changing collection sitemap eligibility; the existing minimum-star threshold stays unchanged.

## Decisions

### 1. Create at registration and backfill existing users once

Use the existing idempotent collection operation after the authentication/registration path. It returns an existing row unchanged or creates a default open row and dispatches collection vector maintenance only for an actual insertion. Keeping this server-side path also provides a retry if the initial registration-time creation fails; it does not depend on a dedicated client provisioning request.

New rows use the existing collection defaults for a free collection, open status, `show_marks=true`, `allow_marks=true`, and `show_profile=true`. Generate the public code with the existing MD5-based approach and preserve the alphanumeric code contract. Generate a localized default name from the user's language and name, with a non-empty generic fallback when the user name is blank. Existing rows retain their status and metadata, so a curator-closed collection is never reopened.

Add a one-time PostgreSQL data migration for active users who have no collection. The migration inserts only missing rows with those same defaults and localized names, generates one stable code per inserted row, and uses `ON CONFLICT (owner_id) DO NOTHING` for idempotence. Existing open and closed rows are excluded from writes. Database triggers initialize collection stats from existing stars. After migration, run the existing `vector:refresh --kind collection` mechanism from the highest pre-backfill collection ID so newly inserted open collections receive their normal vector maintenance without introducing a new backfill framework.

Do not create collections on star writes and do not add collection-setting streams or other local-first settings work. Those approaches expand the product and synchronization scope beyond default enablement.

### 2. One data migration, and visibility behavior stays untouched

This change ships one data-only migration and no table or column changes. Neither rollout nor steady-state operation updates an existing collection's `status`, sends notifications, creates opt-out records, or modifies codes, metadata, ownership, bookmarks, or subscriptions. No visibility backup or restoration procedure is needed because existing rows are excluded from writes.

Retain `USER_INFO_ENABLE_SETTING` and `USER_INFO_DISABLE_SETTING` for compatibility. After rollout they remain the close/reopen channel for the new Web controls as well as for older clients. Their create branch keeps the requested status, while their update branch sets it explicitly. New Web code no longer calls the enable route for initial setup.

### 3. Make `/mine` a read-only non-null owner contract

After provisioning, `/mine` always returns `MyShareCollectionInfo` for an active authenticated user. Update the domain return type and Web composable to use that contract instead of treating absence as normal. Keep response changes additive for other clients.

The first-star cue needs no new server persistence. The client recognizes a successful local transition from zero starred bookmarks to one; if that local count is unavailable, it may show the cue once instead of delaying feedback. A per-account browser-local flag bounds repeats within that browser, while a known nonzero starting count suppresses it. `/mine` supplies the collection address but does not decide whether the cue should appear. Server-side state would cost a column, an authenticated marker endpoint, and a permanent owner-response field for a single non-blocking cue, so this change declines it.

### 4. Replace enablement with the existing collection summary and direct actions

Simplify `StarredSharePrompt` into an always-available owner collection card after `/mine` loads. Remove the star-count threshold and `EnableCollectionModal` along with initial-enablement localization. Preserve the original open-collection hierarchy: lightweight status, collection name and subscriber count on one line, description, and copy/view actions. An open collection with no custom description shows a concise explanation that stars automatically form a recommendations page with a shareable link. A previously closed collection uses the original single-line mini entry from the reference UX, with `Reopen collection` replacing `Enable collection`. It has no full guidance card, dismiss flow, Manage Collection, or setup form, and reopens the existing collection directly.

Remove the narrow-viewport `display:none` behavior and adapt the existing grid so the summary and actions remain usable. Keep the change within the current Web visual profile and semantic tokens. The public `/c/[id]` empty state can be retained and covered by tests rather than redesigned.

The management page no longer redirects away when `/mine` has no code because provisioning guarantees one. Rename remaining user-facing “enable/reopen” copy to open/close or public/closed terminology while retaining the existing controls and stable URL behavior.

### 5. Centralize best-effort first-star discovery on Web

Add a Web helper invoked only after a successful transition to starred. Each call path supplies whether that action changed its locally known starred count from zero to one and the triggering control as its anchor. When the local count is unavailable, the helper treats the action as discovery-eligible instead of delaying feedback; a known nonzero starting count remains ineligible. The helper returns early when the per-account browser-local flag is set or the action is ineligible; otherwise it replaces the ordinary star-success feedback with a non-blocking bubble near that control. Extend `CursorToast` to support a normal-weight, non-underlined action and a roughly four-second presentation, using the existing global Toast only when anchoring is unavailable. This works identically for REST and local-first writes and does not wait for PowerSync upload or a server stats update. The copy introduces the starred collection and offers “去星标页看看”; it contains no public-visibility warning or confirmation.

Key the browser-local flag by `userId` so switching accounts in one browser cannot suppress another account's cue. Set the flag only after the cue is presented. The cue action opens `/bookmarks?filter=starred` within the app rather than opening the public collection. It therefore needs no collection-code refresh and has no cross-account address risk. If presentation fails, preserve the successful star result and show the ordinary success Toast. If the flag write fails after presentation, do not append another Toast; the accepted consequence is a possible repeat in that browser. Do not retry aggressively or block later starring.

Call the helper from the successful star paths in `BookmarkCell.vue` and the snapshot detail page `/b/[id]`. Both REST and local-first writes use the same post-success helper. Unstarring and failed writes never invoke it.

## Risks / Trade-offs

- [Users without a collection become public after default provisioning without notice] → This is an explicitly approved product decision; verify that only newly provisioned rows receive open status and that all existing open and closed fixtures remain unchanged.
- [One-time backfill performs collection stats and vector work] → Insert only missing active-user rows, batch vector refresh from the pre-backfill ID cutoff when needed, and record the authorized operational commands rather than running them during development.
- [Concurrent registration could create duplicate rows or unstable codes] → Rely on the owner uniqueness constraint and per-attempt code inference; test parallel requests.
- [Old and new Web clients coexist during deployment] → Keep visibility endpoints and response fields compatible; old enable calls remain valid open/create operations while new clients bypass them.
- [The cue reappears when a user unstars back to zero and stars again from another browser] → Accepted: the local zero-to-one transition suppresses later stars that do not reset to zero, and the per-account browser-local flag covers the same-browser case; keep all cue failures isolated from starring.
- [Provisioning makes previously unenabled collections with ten or more stars sitemap-eligible] → The sitemap query and its existing threshold stay unchanged; monitor the eligible set through the existing stats table rather than counting bookmarks per request.

## Migration Plan

1. Record the highest existing collection ID as the vector-refresh cutoff, then run the one-time data migration through the authorized release process. It inserts missing collections for active users only and leaves all existing rows unchanged.
2. Deploy the API registration and read-only owner-contract changes. New registrations create the default collection through the existing server path; `/mine` only reads it. Deploy the Web direct-sharing and first-star cue changes, with older clients compatible through the retained visibility endpoints.
3. Run the existing `vector:refresh --kind collection --after-id <cutoff>` path with authorized task configuration, and verify registration, backfill idempotence, preserved open and closed fixtures, stable URLs, initialized stats, empty and non-empty public pages, manual close/reopen, the per-browser cue bound, and unchanged sitemap eligibility.
4. If application rollback is required, deploy compatible prior code. Backfilled rows retain their created state and existing rows were never modified, so no visibility restoration is required; do not blanket-delete or close collections during rollback.
