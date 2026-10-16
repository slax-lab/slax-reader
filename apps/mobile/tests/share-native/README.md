# Controlled cold-main iOS share acceptance

This standalone UIKit sender and XCTest control target exercise the actual compiled Share extension while the Expo application stays closed. They are never imported by production or ordinary UI fixtures. Use a newly created, owned iOS simulator; never reuse an upgrade/data fixture or a personal device.

`controller.mjs` supplies bounded synthetic success, expired-authentication, HTTP 400 and HTTP 503 responses on an ephemeral loopback port. It validates the exact synthetic token, URL payload and `SlaxReader/iOS 1.0.25 (757)` header without reporting the token. No request reaches a backend. The cancel case delays its response so actual extension dismissal can cancel the in-flight native task.

`prepare.mjs` accepts an explicit device UUID, run ID, controller origin and the preserved main/share simulator artifact. It stages a new marked temporary directory, copies only the public development artifact, changes extension API origins/ATS configuration, and signs that copy with public ad hoc App Group entitlements. It compares every file-backed Mach-O section before and after these changes; code-signature/link-edit metadata is outside that comparison. It does not read an operator configuration, account, certificate or private key.

The generated small Xcode project compiles only `ShareFixtureHost.swift` and `ShareFixtureControl.swift`. The host refuses to edit shared preferences unless a regular controlled owner record matches both the run ID and the simulator UUID in its actual App Group path. The orchestrator must write `slax-share-fixture-owner.json` into the newly allocated group before launching the host. The host then prepares synthetic current preferences or a synthetic legacy protobuf; it never opens a database.

Run `build-for-testing` and `test-without-building` against the same explicit simulator UUID, with parallel testing disabled and maximum concurrent simulator destinations set to one. Preserve the complete XCTest result, system-share input log, raw screenshots, public executable/input hashes, controller receipts, main-process state and actual device profile. Failed guards or captures remain evidence of failed attempts.

The seven sender scenarios cover new-store success, legacy-store success, absent authentication, expired authentication, backend rejection, retryable service failure and native cancellation. The current signed-out fixture also leaves synthetic stale authentication in the legacy store to verify that the empty current store takes precedence. The preserved earlier seven-case report predates that stronger fixture.

The separate `safari-success` scenario opens only the owned loopback page in Safari. Its unique document title must appear in the actual extension request; a sender-provided subject is insufficient evidence. The preparer takes activation/preprocessing attributes from the current application-owned configuration plugin and records its hash, while retaining unchanged compiled extension sections. Initial Safari observations capture native controls before an action driver selects them.

Preparation or compilation is not runtime acceptance. The seven sender cases do not establish publisher signing, Safari preprocessing/title extraction, Firebase delivery, source-versus-target visual parity or TestFlight availability; those remain separate checks.
