# Mobile data compatibility

## Kotlin upgrades reset local data

The approved `mobile-legacy-reset` policy replaces lossless Kotlin database adoption. Android and iOS detect the fixed old database location, discard that old local data, and initialize the normal new PowerSync database. They do not open the old file, compare table lists, compute preservation checksums or consult migration profiles.

| Platform | Old database | New database |
| --- | --- | --- |
| Android | App data root `databases/powersync.db` | App files `slax-react-native/powersync.db` |
| iOS | Application Support `databases/powersync.db` | Application Support `slax-react-native/powersync.db` |

Detection includes the SQLite WAL/SHM/journal family. A `.slax-legacy-reset` marker beside preferences resumes an interrupted cleanup. The marker is removed only after preference cleanup and before new database initialization. Once the old files and marker are absent, restarts and ordinary Expo upgrades preserve the new database. A legacy preference file alone is not a reset trigger.

The selected reset deletes old pending writes, local reading positions, account content caches and obsolete database/cleanup state. It intentionally does not upload or convert old queued operations. Server records are not deleted. Existing synchronization repopulates cloud-backed records and ordinary cache policy reacquires content; an offline first launch must wait for connectivity rather than reset repeatedly.

Only fixed app-owned slots are removed under native ownership and preference locks. Historical absolute paths and redirected children are not deletion targets. Real file I/O failures remain retryable. This is not a catch-all reset for network, token, lock or ordinary new-database errors.

## Minimal preference continuity

The current store is `slax.preferences.v1.json`. Android reads old `user.preferences_pb` from the files directory; iOS reads it from `group.app.slax.reader`. Import is best-effort and limited to main authentication/user identity, last refresh, selected environment, language and stable analytics identity. A current identity takes precedence. Corrupt legacy preferences lead to normal login rather than a migration barrier. Nonessential legacy settings return to defaults.

Pending sign-out wins: the old bearer is discarded and its cleanup marker is completed during reset, so a successful new provider/API login is not rejected by an obsolete pending operation. A corrupt current preference JSON during an already-selected reset is treated as signed out rather than falling back to stale credentials. The old preference source is retired when cleanup finishes. Main-app and extension preference readers serialize access; share readers expose no credentials during pending reset. Never log preference contents or credentials.

## Ordinary runtime and account behavior

After local storage preparation, present Login or the authenticated shell from local identity without waiting for network refresh or full sync. Data services wait for actual ownership and database initialization; protected API/PDF requests and PowerSync acquisition still require current account/origin-scoped credentials. Stale async work cannot publish after stop, sign-out or account replacement.

Normal Expo account cleanup remains account-isolated. Repository/cache objects have revocable leases, pending writes are retained during network failure, and old-token unauthorized responses cannot clear a newer session. The one-time Kotlin reset does not authorize discarding offline work created in new storage. Main refresh and signed sync-token expiry continue to use their existing policies.

## Verification

- `node apps/mobile/tests/data/legacy-reset-host.mjs` compiles and executes the production Kotlin/Swift fixed-path helpers. Set `JAVA_HOME` and `SLAX_KOTLINC` to installed toolchains when necessary.
- `tests/data/compatibility.test.ts` covers minimal identity import, pending logout, malformed preferences and idempotence.
- `tests/data/runtime-credentials.test.mjs` exercises actual runtime/session recovery and preservation of newly created offline writes after reset.
- The guarded development entry `NativeAdoptionFixtureApp.tsx` now verifies reset, not adoption: it accepts only the old synthetic producer marker, starts the real new runtime with blocked loopback transport, verifies empty old queue/local rows, and checks logout/relogin. It writes `native-reset-report.json` inside that synthetic installation.
- Standard check, bundle, native-resource and Android/iOS builds remain required. Host tests and synthetic session acceptance do not substitute for real provider/store/device acceptance. Current results and gaps belong in `openspec/changes/mobile-legacy-reset/validation.md`.

Old fixture reports under `tests/data/adoption-fixtures/reports` are immutable historical evidence of the retired preservation implementation, not requirements or proof of current reset behavior. Old SDK producers remain useful for generating authentic local storage in isolated reset tests.
