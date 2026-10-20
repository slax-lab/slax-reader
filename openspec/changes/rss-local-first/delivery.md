# Delivery notes

OpenSpec: rss-local-first

RSS subscriptions and latest entries now read from the account's PowerSync database on Web and Mobile. REST remains responsible for writes, article detail and history. The review follow-ups remove a quadratic SQLite join, let admitted native caches open independently of network readiness, reconcile write overlays when synchronization wins the race, and bound Web mapping to the visible source window. Shared Web cookie consumers validate runtime configuration and string tokens so application typechecking can complete.

Real native startup exposed an existing admission mismatch: the current SDK creates `user_version=0` databases while the guard required `1`. Native-created installations now admit `0` or `1`, retaining the format, exact table-set, path and owner checks; Kotlin adoption remains strict at `1`. The native RSS All view also omits its empty 48-point source-action toolbar, while a selected source retains its existing refresh and menu controls.

## Version decision

The human explicitly declined an additional Mobile version bump. Native acceptance ran with version `1.0.25`, build `771`, previous build `770`. Integration with the latest `dev` inherits its already assigned version `1.0.25`, build `773`, previous build `772`; this task introduces no version metadata difference relative to that base. CLI and Extension shipped behavior are unaffected.

Mobile CI performs checks and JavaScript bundle validation. The separate EAS workflow triggers cloud builds with automatic TestFlight/Play internal submission only after a `dev` push increases `buildNumber` and Mobile CI passes. This task adds no build-number increase relative to `dev`, so its merge alone does not qualify for that trigger. No cloud build, signing, submission, or store publication is performed by this task.

## Production rollout checklist

These are deployment steps for the release owner, not operations performed during local verification:

- Apply `20261019090000_rss_local_first` and deploy the API before releasing clients. The migration adds nullable `sr_rss_feed.icon_url` and `sr_rss_entry.is_history BOOLEAN NOT NULL DEFAULT false`; it preserves columns and existing client contracts.
- Confirm the production PostgreSQL replication publication includes `sr_rss_subscription`, `sr_rss_feed` and `sr_rss_entry`, and that the synchronization service can read `sr_user` and `sr_user_lab_feature` for authorization.
- Publish the reviewed `rss_v1` stream from `deploy/local/powersync-local/sync_rules.yaml` to the production Sync Config. Keep `auto_subscribe: false`, the active-account and RSS Labs predicates, and owner-only subscription rows. Do not change the existing streams or `schema_version`.
- Verify two accounts subscribed to the same feed receive only their own subscription remarks, and disabling RSS removes RSS rows at the next checkpoint while retaining bookmarks.
- Release Web and then Mobile after their normal checks and the later Mobile version decision. Check that previously initialized local databases open without recovery and that cached RSS renders while offline.
- Before a Mobile build with the iOS 27 SDK, confirm that release project generation adopts the Scene lifecycle. The unmodified isolated Expo 57 project built successfully but failed to launch under that SDK; the RSS acceptance fixture explicitly enables Expo's existing Scene support only inside its temporary project. That fixture preparation does not migrate production native configuration. See the [official Expo migration guide](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md) and `native-verification.md` for the exact acceptance conditions.
- For rollback, stop clients subscribing to `rss_v1` or remove that stream while retaining the additive columns. REST clients remain supported; do not roll back the database by dropping columns.

See `verification.md`, the earlier seeded `native-verification.md`, and the real local sync evidence in `real-sync-verification.md` for actual results and their limits. No production migration, Sync Config publication, deployment or store submission is part of this verification task.

## Integrated validation (2026-10-20)

The feature commit was integrated with `origin/dev` at `a3fb9492`. The merge has no unresolved paths. `LibraryScreen.tsx` retains the upstream Observe interactivity signal and active-state bookmark/collection watch gating alongside RSS wiring; the persistent RSS fixture retains upstream native resource ownership for non-PDF scenarios; the adoption profile test no longer depends on native evidence artifacts retired by the target branch.

The final host `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- check` completed its static checks and TypeScript compilation, then exited 1 under concurrent Web typechecking: 1,327 of 1,329 tests passed, with the Kotlin image-registry compile reaching its 120-second timeout and the PDF browser test reaching its 60-second timeout. After the competing check finished, `node --experimental-strip-types --test apps/mobile/tests/data/image-registry-native.test.mjs` passed 2/2 and `node --experimental-strip-types --test apps/mobile/tests/reader/pdf-browser.test.mjs` passed 4/4. The full suite was not repeated. No simulator, Android runtime, bundle, or native build was run for integration validation.

The Web typecheck initially could not resolve the merged lockfile's declared `parse5` package because its workspace link was absent. `pnpm install --frozen-lockfile --ignore-scripts` restored the missing link without changing the lockfile; `pnpm --filter @apps/slax-reader-dweb typecheck` then passed with exit 0. Nuxt reported absent optional public development settings and a Turnstile key; no credentials or secret files were used. The parent integration check also passed `pnpm exec openspec validate --all --strict` (65/65).

The refreshed Bugs, Security and Compliance review against the latest `REVIEW.md` found no Important findings. The local feature diff matches `rss-local-first`; integration preserves the upstream Observe and retired-evidence changes. Existing real-sync and single-iOS-simulator evidence remains in the linked reports; this integration pass did not repeat native acceptance.
