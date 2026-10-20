# Delivery notes

OpenSpec: rss-local-first

RSS subscriptions and latest entries now read from the account's PowerSync database on Web and Mobile. REST remains responsible for writes, article detail and history. The review follow-ups remove a quadratic SQLite join, let admitted native caches open independently of network readiness, reconcile write overlays when synchronization wins the race, and bound Web mapping to the visible source window. Shared Web cookie consumers validate runtime configuration and string tokens so application typechecking can complete.

Real native startup exposed an existing admission mismatch: the current SDK creates `user_version=0` databases while the guard required `1`. Native-created installations now admit `0` or `1`, retaining the format, exact table-set, path and owner checks; Kotlin adoption remains strict at `1`. The native RSS All view also omits its empty 48-point source-action toolbar, while a selected source retains its existing refresh and menu controls.

## Version decision

The human explicitly requested keeping Mobile version `1.0.25`, build `771`, previous build `770`. This task must not increment or regenerate production version metadata; the release version will be assigned later in the task sequence. CLI and Extension shipped behavior are unaffected.

The current Mobile EAS workflow requires a higher `buildNumber` on a push to `dev`, followed by successful Mobile CI, before submitting cloud builds. Keeping the manifest unchanged does not qualify this change for that automatic submission. Store publication remains a separate operation.

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
