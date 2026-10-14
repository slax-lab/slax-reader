# Fresh Source iOS shell SDK packaging preparation

This is a prepared, isolated Swift shell build. Default invocation performs only read-only admission. It has not compiled, signed, installed or launched any application.

The preceding Source44 shell linked with `LC_BUILD_VERSION` iOS Simulator 7, minimum16.4 and SDK16.4. Its real device observation was393×852 with safe-top61, so it cannot serve as the required402×874/safe-top62 baseline. The existing `UILaunchScreen` entry is already present. A linked-SDK compatibility effect is an evidence-based hypothesis; this preparation does not establish its cause or fix the viewport.

The new executor preserves Source44's109 copied app files, unchanged Info.plist, both Swift source inputs, all retained J framework/resource bytes and the original source. It changes only the fresh shell link command by passing explicit `-platform_version ios-simulator 16.4 26.5`. It parses the actual executable load commands before signing and again afterward, rejecting any metadata other than platform7/min16.4.0/SDK26.5.0. Manual Mach-O patching and window or reading-position overrides are absent. Historical33-section proof remains historical; copied framework bytes must remain identical.

A separate exact Root grant is mandatory for execution. The new root is capped at256MiB in both logical and allocated accounting, including buffered command output and record reserve. Availability must be at least3GiB+0.6GiB before copying and at least3GiB throughout. The total window is120seconds, Swift at most60seconds, other native commands at most15seconds each, with at most8MiB captured output per command. Only its own command process group may be terminated. There are no device, database, control/KMP build, Metro, old artifact mutation or cleanup paths.

Every generated symlink is refused. A legitimate temporary LLVM/PCM lock can therefore stop the cold build. No link allowance or warm-cache copy is introduced. Root's read-only settled-cache metadata observation is preserved in the plan only as a potential separately reviewed future option.

Pinned Xcode Python3.9 ran16 focused host guards successfully and the default closed-input admission passed. Host command shims establish orchestration and refusal behavior; they never establish native build, viewport, gesture, persistence, callback, visual or publisher acceptance. The initial15-test run found a missing pre-loop pending-output cap check; its14pass/1fail source and raw repeat-capture are retained under `initial-host-negative`. That cap check and a final-result accounting guard are included in the final16-pass run.

Any future successful build can claim only an isolated ad-hoc simulator shell built/signed/verified. A new device allocation must verify402×874/safe-top62. Physical scrolling and optional read-only database observations require their own new grants and ancestry; the consumed Source44 device grant is not reusable.
