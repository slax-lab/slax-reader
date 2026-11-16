# Validation

OpenSpec: `publish-native-passkey-associations`.

## Scope and authorization

The requester explicitly authorized a separate association-only Draft PR on 2026-11-12, based on latest `origin/dev` (`feba1157`), before continuing the separate Passkey feature's native acceptance. This worktree/branch is isolated from the feature/native build worktree. The change contains two public JSON assets and two precise JSON header rules; no Native/API/interactive UI implementation is included. Mobile remains at the previously authorized version 1.0.29 (804); no application package or native build output changes in this PR.

No interactive UI surface changes, so DESIGN.md's UI demo and hands-on checkpoints do not apply to this support PR. No user data, passwords, signing keys, credential rows or secrets are added. Public native association is the behavior being changed; it is not a claim that the native feature is already enabled or accepted.

## Automated and running-environment checks

- `pnpm install --frozen-lockfile --ignore-scripts` passed without dependency/lockfile edits.
- The isolated support branch's `pnpm web -- build` passed with explicit non-secret verification configuration (`SLAX_ENV=beta`, public URLs under `r-beta.slax.com`, and fixture OAuth/cookie values). The resulting `dist/.well-known/` contains both documents with the exact source JSON payloads; `dist/_headers` contains both precise `content-type: application/json` rules. Log: `/tmp/slax-passkey-native-test/association-only-web-build.log`. This fixture-configured artifact is verification-only and must not be deployed as a live application.
- Started the actual built artifact with `wrangler pages dev dist --ip 127.0.0.1 --port 4298`, explicit empty env file and isolated persistence, with dotenv/process-env loading disabled. Both well-known GETs returned HTTP 200, `application/json`, unchanged JSON payloads, no authentication and no redirects. This exercises the actual Cloudflare Pages serving path, rather than a custom static test server. Logs: `/tmp/slax-passkey-native-test/association-only-pages.log`, `/tmp/slax-passkey-native-test/association-only-http-evidence.json`.
- Apple identifier is `8G3A932HJG.app.slax.reader`, supplied/confirmed by the requester. Android target is `com.slax.reader`; its SHA-256 matches the Play Console application-signing Digital Asset Links example and Signer #1 of the installed phone's APK, checked with `apksigner verify --print-certs`. The unrelated source-stamp signer is not used. No private signing key was read or exported.
- Android relation is only `delegate_permission/common.get_login_creds`; URL-handling permission is deliberately absent.
- `openspec validate --all --strict` passed (139 items, zero failures). `git diff --check` passed.

## Pre-push review

Independent Codex review covered Bugs, Security and Compliance. No source Bug, Security finding or Nit was found. Its only pre-delivery Important Compliance item was this missing evidence document; the isolated build and Pages results above close it. Scope/capability separation was checked against the feature branch: this change owns `native-passkey-association`, and the feature retains `passkey-authentication` without a duplicate association delta.

## Deployment and native follow-up

No public deployment, WAF/security-rule modification, certificate/key rotation or live Worker variable change was performed. Current public association URLs do not yet serve these documents. The existing Web workflow deploys after a human merges the PR into its environment branch; promote through the human-reviewed beta/main flow to publish the same files on `r-beta.slax.com` and `r.slax.com`.

After each environment release, verify `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` over HTTPS return 200 JSON without a redirect or login. Continue signed-device Passkey acceptance after the development association is live. Differently signed local APKs require their own explicitly authorized development association; the confirmed Play identity must not be treated as an arbitrary local test signature. Live-domain, Apple/Google platform-cache and native biometric/credential-chooser acceptance are not claimed by this support PR.
