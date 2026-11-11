# Design

## Context

Mobile CI runs `pnpm mobile -- check` and `pnpm mobile -- bundle` on pull requests and daily full validation. `expo-mobile-migration` records that routine CI does not build native applications and that native acceptance is explicit local/operator work. The EAS project already has the production environment, iOS and Android Firebase file secrets, the `SlaxShare` extension declaration, and signing credentials.

## Goals / Non-Goals

**Goals:** Trigger EAS cloud builds only for an explicit Mobile release bump after CI passes; use EAS for the native build; avoid GitHub runner billing for the build duration.

**Non-Goals:** App Store review or Play promotion beyond the internal track, signing ownership changes, native builds on GitHub runners, evidence retirement, or Git history changes.

## Decisions

1. Trigger only on a push to `dev`; do not trigger on pull requests, `beta`, or `main`.
2. Compare `apps/mobile/package.json` with `github.event.before`. Require an increasing `buildNumber`, a valid non-decreasing `version`, and `previousBuildNumber < buildNumber`. Validate `appVersionSource: local`, the `production` EAS environment, the Android platform, the `SlaxShare` target, and `.easignore` rules that keep `apps/mobile/tests` and `apps/mobile/fixtures`.
3. Reuse `mobile-ci.yml` with `full_validation: true`. Only a successful Mobile CI result permits the EAS job.
4. Run `eas build --platform all --profile production --non-interactive --no-wait --auto-submit`. `--auto-submit` hands each finished build to EAS Submit with the same-named `production` submit profile (iOS `ascAppId`, Android `track: internal`), so submission happens on EAS after `--no-wait` returns; no separate `eas submit` step or GitHub-side store credential is needed. EAS environment/file secrets and credentials own Firebase, signing and submission values.
5. Key workflow concurrency by commit SHA so rapid pushes do not replace a pending bump; key the EAS job by version/build so the same release is serialized.
6. The GitHub workflow reports only whether the trigger was accepted. EAS owns build status and failure visibility; no additional notification channel is added.
7. Add a note to the active `expo-mobile-migration` change: a separate delivery change owns the EAS trigger, and routine Mobile CI remains check/bundle only.

## Risks / Trade-offs

- An EAS build failure is not a GitHub workflow failure.
- Re-running the workflow for the same version queues another pair of EAS builds and submissions; the stores reject the duplicate build numbers.
- A missing or invalid App Store Connect API key or Google Play service account key fails that platform's submission on EAS, not the GitHub workflow.
- Android and iOS signing credentials must exist in EAS; the workflow cannot verify their presence or contents.
- The workflow does not prove native acceptance. A store upload makes the build available for internal testing only; review and wider release stay manual.
