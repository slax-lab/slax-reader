# Controlled native cross-process preference verification

Status: iOS and Android actual device execution passed both stale-CAS and lock-read modes. Android results are independently retained in `reports/android-native-preference-cas.json`. `reports/ios-native-preference-cas.json` records the retained compiled main bridge, separate literal-native process, exact revisions/timings and preservation checks. This test is separate from immutable database/service/repeated-installation reports and does not invoke adoption. The constrained reviewed default runtime profile was wired independently after the iOS CAS result; later controlled CAS reports describe profile use in that fixture path rather than a global rollout flag.

The main process uses `SlaxLegacy` from the retained actual native application. A second CLI process compiles the exact existing native lock, snapshot decoder and CAS bodies. Only directory resolution and the Expo callback wrapper are replaced by a bounded CLI entry. The builder records the production source hash, each literal body hash, template hash, public executable hash and this adaptation. It performs no dependency fetch or application installation. The Android compile requires the cached public Kotlin compiler classpath and standard library through `SLAX_KOTLIN_COMPILER_CLASSPATH` and `SLAX_KOTLIN_STDLIB`; iOS uses the installed simulator SDK and public ad hoc signing.

The controller/probes require an explicitly identified controlled simulator/emulator, the genuine original Kotlin producer marker, and a completed original-four real-service report. They reject physical Android serials, another application/group, unrelated store paths, stale request nonces and a probe whose source/template/executable differs from its ownership marker. iOS resolves `group.app.slax.reader` within the same simulator; Android uses only the application files directory under the application UID. No operator configuration, credentials, private keys or service JWTs are read or logged.

Build without touching a device:

```sh
node apps/mobile/tests/data/adoption-fixtures/tooling/build-preference-probe.mjs ios
node apps/mobile/tests/data/adoption-fixtures/tooling/build-preference-probe.mjs android
```

After coordinating ownership of the retained completed-service device, write one request with the public executable from the builder marker:

```sh
node apps/mobile/tests/data/adoption-fixtures/tooling/native-preference-control.mjs \
  --platform ios --device CONTROLLED_UUID --probe PUBLIC_PROBE \
  --mode stale-cas --request
```

Launch the already installed selected development fixture using its dedicated Metro server. The main bridge captures a real native snapshot and publishes `waiting-probe`, without exposing preference contents. Then run the separate process:

```sh
node apps/mobile/tests/data/adoption-fixtures/tooling/native-preference-control.mjs \
  --platform ios --device CONTROLLED_UUID --probe PUBLIC_PROBE --execute
```

`stale-cas` commits a synthetic second-process key from the captured revision. The production `PreferenceStore` receives the real earlier snapshot as a delayed read, encounters an actual native CAS rejection, rereads/rebases and commits the main-process key. Both keys, unrelated preference values, original DataStore bytes and complete database checksums must survive. `lock-read` holds the native preference lock for eight seconds in the second process; the actual main native read must wait until release, without changing revision or values. Run modes separately with fresh nonces, preserving each native result before the next mode.

`--status` reports only a matching passed result. `--cleanup` verifies that result and removes only its matching CAS request, returning the isolated adoption dispatcher to its prior phase. Synthetic keys, reports, database and sandbox remain intact. This is native cross-process locking/CAS evidence; publisher signing, background suspension, release distribution and TestFlight processing remain separate acceptance.
