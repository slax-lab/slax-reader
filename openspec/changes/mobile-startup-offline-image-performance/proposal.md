# Proposal

## Why

Mobile's normal startup still carries legacy-discovery work, while automatic article caching, synchronous storage, and broad UI updates compete with foreground reading. The user requested the full agreed performance correction, reusable Expo-based images, passing tests, and an incremented TestFlight delivery rather than another analysis-only checklist.

## What Changes

- Separate one-time installation/adoption from normal initialized startup, including signed-out relaunches; retain safe first-adoption and recovery without routinely rescanning or hashing historical data.
- Stage startup around local presentation and admitted cached data, reuse startup snapshots and Labs requests, and load optional page/PDF resources on demand without an artificial minimum loading interval.
- Replace monolithic article-plus-images jobs with prioritized, scoped, deduplicated body/image/PDF tasks, persistent missing-resource recovery, bounded retries and resource budgets.
- Move heavy storage and image transport to asynchronous native workers, commit files atomically, share controlled resource URIs, and shorten maintenance database transactions.
- Automatically cache PDFs under the same eligibility, retention and cache-window policy as ordinary articles, with no standalone PDF offline-download button. Preserve integrity/access checks while improving offline metadata admission and coalescing full-body responses from servers that ignore Range.
- Add the user-requested `expo-image` integration, reusable image/zoom presentation and continuous UI-thread gallery paging with bounded preparation and decoding.
- Isolate draft/AI/document updates, virtualize comments, gate optional hidden-route work, incrementally refresh Markdown, and complete interruptible/reduced-motion behavior and immediate local-action feedback.
- Open PDFs like articles (header first, then a body skeleton until pages are ready, with no PDF loading label), speed up sidebar settling, and add WeChat-style long-press Save to Photos / Share / Cancel actions for reader and gallery images.
- Validate the actual deliverable, increment the package build monotonically, upload a production-configured publisher-signed TestFlight build, push one feature branch/PR, and clean only task-owned build outputs after preserving delivery evidence.

## Capabilities

### New Capabilities

- `mobile-performance-lifecycle`: Installation-aware startup, resource-budgeted foreground offline acquisition, reusable image interactions, and bounded visible-reader update work.

### Modified Capabilities

None in the current living-spec inventory. Existing `release-branching` requirements remain unchanged. The unarchived `expo-mobile-migration` change retains its six capability paths and all compatibility, security, native-scroll and immediate-cached-content requirements; this change adds performance lifecycle guarantees without duplicating those delta files or marking its outstanding acceptance complete.

## Impact

- `apps/mobile/src/{App,runtime,data,domain,reader,components,rss,pdf,payments}`, application-owned Kotlin/Swift modules, PDF asset generation, and existing unit/mounted-host/native-resource suites.
- `apps/mobile/package.json`, `pnpm-lock.yaml`, generated native projects through supported prebuild, and updated mobile compatibility/release documentation and public evidence.
- Optional dependencies: Expo SDK 57-compatible `expo-image`, `expo-media-library` (write-only photo saving, iOS add-only usage text, no Android granular media-read permissions) and `expo-sharing`; reuse installed Reanimated/Gesture Handler. No new animation/gallery/test framework is implicit.
- No backend endpoint, synchronized production schema, application identity, publisher identity, or share Firebase change.

## Non-goals and delivery boundary

No OS background-transfer service, KMP/native rewrite, automatic list-library replacement, experimental framework switches, backend deployment, branch merge, or public App Store publication. This planning workflow ends after reviewable artifacts; implementation starts only after the required subsequent apply instruction. Existing native/test limitations remain explicit until exercised, and successful upload is distinct from TestFlight processing and tester availability.
