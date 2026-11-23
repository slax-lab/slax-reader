# Design

## Reading position after a late switch

`useReadingPosition` runs one restore attempt when the article DOM and `ready()` are both true. On a deferred owner page, `decideDeferredTakeover` sets `positionReady` after the 1.5 s wait while `localFirst` is still false, so `restore()` sees `enabled() === false` and calls `finish()`. When `onLocalSourcesReady` later sets `localFirst`, nothing restarts the attempt, and the next `capture()` at the top of the page calls `clear()`.

Decision: the composable returns `retry()`, which starts one new attempt when no restore has run, the first attempt has ended, and the reader has not interacted (no abort event and the page has not moved since mount). `[id].vue` calls it from `onLocalSourcesReady` right after it sets `localFirst`. Before that, `capture()` already returns early because `enabled()` is false, so the saved position is neither cleared nor overwritten while the page is on REST. The existing abort listeners (wheel, touch, navigation keys, reader navigation) and the `initial && scrollY > 0` check keep the "reader already moved" cases from jumping.

Alternative: keep `positionReady` false until the switch. That blocks REST mark drawing paths that read `ready()` and reintroduces the wait the deferral removed.

## Marks written before the switch

`marks` hands over to local rows when `localMarksCoverShown(restMarks, local)` holds, but `restMarks` only holds the first REST response. A REST-phase write updates the selection layer's own state, not `restMarks`, so a new highlight is absent from the comparison and the switch removes it until synchronization delivers it.

Decision: `BookmarkArticleLocalFirst` reports REST-phase mark writes (`ADD_MARK` with the returned `mark_uid`, `DELETE_MARK` with its `mark_uid`) through the same switching client it already uses for local writes. `[id].vue` keeps them in `restMarkWrites` (added and deleted uuids, reset with the account generation) and passes them to `localMarksCoverShown`: an added uuid must be present and live locally, a deleted uuid must be absent or deleted locally, and a deleted uuid from the REST response no longer needs its comment to match. A comment's text is compared only for marks from the REST response, because the REST-phase write does not return the stored comment row.

Alternative: refetch REST marks after each write. That adds a request per write and still races the switch.

## Back after reloading an article

The exit guard returns `false` after assigning `location.href`. For a popstate navigation, vue-router answers a `false` result with `routerHistory.go(-delta)`; Chrome cancels the cross-document load that the assignment started, and the page stays on the article.

Decision: for a history traversal the guard calls `location.replace(to.fullPath)` and returns a navigation result that stays pending. A traversal is recognized because, when guards run, the address bar already shows the destination (`location.href` equals the resolved `to.fullPath`), while push and replace navigations still show the current page. A pending result neither finalizes the route, so the old document never mounts the destination, nor rewinds history, so the reload proceeds. If the unload is suppressed (for example by a `beforeunload` prompt the reader declines), the result resolves to `false` after `DEFERRED_EXIT_RETRY_MS`, the router rewinds, and the address returns to the article. Push and replace navigations keep the current guard.

Alternative: let the traversal finish and reload in `router.afterEach`. That renders the destination in the old document before it unloads, which the existing requirement forbids.

## Extension bridge

The plugin treats a top-level `/x/ext-bridge` like any other route. It now returns `unavailable()` when the path is `/x/ext-bridge` or `/x/ext-bridge/` but the page is not the bridge frame. Nuxt renders the bridge page for both forms, so both are covered; a framed trailing-slash URL is also refused because the extension only frames the exact path. The route rule for `/x/ext-bridge/**` (trailing slash) gets the same `frame-ancestors` header. Case variants such as `/X/ext-bridge` render the not-found page, whose responses carry no bridge behavior, so they are left alone.
