# Source native control: completed products recovery

The c234 control-only `xcodebuild build-for-testing` command returned exit 0 with no monitor stop and the terminal `TEST BUILD SUCCEEDED` marker. Its original executor subsequently rejected the Apple-provided runner because it assumed that all three executables had a thin Mach-O header. The original `failure.json` is unchanged and archived here; the executor is unchanged. No native command was rerun.

This separate read-only recovery binds the complete 52-file product tree, raw command buffers, actual FormatVersion 1 `.xctestrun`, thin arm64 host/test, retained 113 copied inputs, signed 109-file original-source app, all earlier public basis bindings and the five unchanged current/copied control inputs. Actual build log paths prove compilation of these retained control sources.

Only this exact Apple copied runner is recognized: FAT32 `cafebabe`, one arm64/subtype-zero slice, offset `0x4000`, size `0x17bd0`, alignment 14 and slice extent ending exactly at EOF. Its underlying thin arm64 slice is byte-identical to the installed Xcode SDK `XCTRunner` arm64 slice; both whole-runner and slice hashes are recorded. The raw log records the actual `lipo -extract arm64` command. This is an artifact-specific recovery, not a general architecture waiver.

All input and product bytes remain in their original locations. Only named public logs/config/source bytes were copied into this evidence directory. No compiler, signing, process, device, source, DerivedData, stage, Metro or cleanup mutation was performed. The helper is unsigned and has not executed a native test. Source 240px measurement, original callback observation, gestures, visual parity and publisher delivery remain pending.
