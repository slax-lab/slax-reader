# Native Passkey domain association

These examples are not published automatically. The examples contain the confirmed Apple Team ID and Google Play app-signing certificate fingerprint for the main application. Native Passkey UI is visible only in the Mobile development profile. Mobile stays at version 1.0.29 (804).

Use the HTTPS hostname from the public Mobile `EXPO_PUBLIC_SLAX_WEB_URL` and the matching API `FRONT_END_URL`. The API derives the relying-party ID from that hostname. The Mobile config plugin points Android `asset_statements` at that hostname’s association file. The Mobile app config derives the iOS `webcredentials:<hostname>` entitlement from the same public Web URL. Do not use the API hostname as the RP unless it is also the configured Web hostname. JavaScript bundle updates cannot add entitlements: regenerate and build the native project after changing the Web URL.

1. The requester confirmed Apple Team ID `8G3A932HJG` on 2026-11-12. The iOS example therefore contains `8G3A932HJG.app.slax.reader`. Deploy it as `https://<rp-host>/.well-known/apple-app-site-association` (no `.json` suffix). Its `webcredentials.apps` entry must match the signed app's application identifier; a separately signed preview app with another bundle identifier needs its own explicit entry.
2. The Android example contains the Google Play app-signing certificate SHA-256 observed in the requester's Play Console for `com.slax.reader` on 2026-11-12. It applies to matching Play-distributed builds. For a locally signed test APK, add its actual signing certificate fingerprint explicitly; its certificate may differ from the Play certificate. Deploy the example as `https://<rp-host>/.well-known/assetlinks.json`. Add each explicitly supported development/release signing certificate to the fingerprint array.
3. Serve both association documents publicly with successful HTTPS responses, JSON content type and no authentication or redirects. Merge these entries with existing association documents instead of overwriting unrelated applications.
4. Configure the API's optional comma-separated `PASSKEY_ANDROID_ORIGINS` allowlist with each corresponding origin. Its exact format is `android:apk-key-hash:<BASE64URL_SHA256_CERTIFICATE_BYTES>`: take the raw 32-byte SHA-256 signing-certificate digest, encode it as URL-safe Base64, and remove `=` padding. This differs from the colon-separated hexadecimal fingerprint in `assetlinks.json`. Do not encode the fingerprint's textual characters. An empty allowlist trusts no Android signing origin. iOS uses the configured HTTPS Web origin.
5. Rebuild signed native apps and verify registration and mailbox-first login against the same RP on actual iOS and Android devices. Confirm cancellation, incorrect mailbox, account replacement, multiple credentials, deletion and existing Google/Apple/email-code sign-in. Verify beta/production UI remains hidden.

The Apple Team ID and Google Play app-signing fingerprint are confirmed. The confirmed hosts are listed below; association deployment and signed-device verification remain pending. A locally signed APK still needs its own matching fingerprint if that certificate differs. No live Worker environment or domain association was changed when recording these public identifiers.

Confirmed Play app-signing SHA-256:

```text
A1:05:FB:8C:2E:15:45:C7:B8:A5:C4:73:E5:29:15:EF:26:21:65:17:D2:95:14:62:D4:7E:0F:66:1D:A9:11:AA
```

Corresponding public Worker variable, to configure for the matching Play-distributed app after choosing the RP domain:

```text
PASSKEY_ANDROID_ORIGINS=android:apk-key-hash:oQX7jC4VRce4pcRz5SkV7yYhZRfSlRRi1H4PZh2pEao
```

Official references: [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains), [Android passkey association](https://developer.android.com/identity/credential-manager/prerequisites), and [Android server registration origins](https://developer.android.com/identity/passkeys/create-passkeys).

## Confirmed environments

| Environment | Web origin / API `FRONT_END_URL` | Mobile `EXPO_PUBLIC_SLAX_WEB_URL` |
| --- | --- | --- |
| Development | `https://r.slax.dev` | `https://r.slax.dev` |
| Beta | `https://r-beta.slax.com` | `https://r-beta.slax.com` |
| Production | `https://r.slax.com` | `https://r.slax.com` |

The native configuration declares all three associated domains. Android asset statements include all three association URLs. Keep each API environment's `FRONT_END_URL` aligned with its own row; this determines its RP ID. Set `PASSKEY_ANDROID_ORIGINS` in each API environment to the public Play signing origin above. These are public variables, not secrets. A local APK signed with a different certificate still needs its own explicitly authorized development fingerprint/origin.

The two files under `apps/web/public/.well-known/` are the Web deployment assets for all three environments. Nitro route rules generate their JSON content type; the files are served without a session. They take effect on each public hostname only after that environment's Web deployment. This does not change client rollout: Beta and production keep the new authentication UI hidden. Existing API bindings and all unrelated settings must be preserved when applying the public variables.
