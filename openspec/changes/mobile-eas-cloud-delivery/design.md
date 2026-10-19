# Design

## Context

Mobile CI runs `pnpm mobile -- check` and `pnpm mobile -- bundle` on pull requests and daily full validation. `expo-mobile-migration` records that routine CI does not build native applications and that native acceptance is explicit local/operator work. The EAS project already has the production environment, iOS and Android Firebase file secrets, the `SlaxShare` extension declaration, and signing credentials.

## Goals / Non-Goals

**Goals:** Trigger EAS cloud builds only for an explicit Mobile release bump after CI passes; use EAS for the native build; avoid GitHub runner billing for the build duration.

**Non-Goals:** Store submission, signing ownership changes, native builds on GitHub runners, evidence retirement, or Git history changes.

## Decisions

1. Trigger only on a push to `dev`; do not trigger on pull requests, `beta`, or `main`.
2. Compare `apps/mobile/package.json` with `github.event.before`. Require an increasing `buildNumber`, a valid non-decreasing `version`, and `previousBuildNumber < buildNumber`. Validate `appVersionSource: local`, the `production` EAS environment, the Android platform, the `SlaxShare` target, and `.easignore` rules that keep `apps/mobile/tests` and `apps/mobile/fixtures`.
3. Reuse `mobile-ci.yml` with `full_validation: true`. Only a successful Mobile CI result permits the EAS job.
4. Submit `eas build --platform all --profile production --non-interactive --no-wait`. Do not use `--auto-submit`. EAS environment/file secrets and credentials own Firebase and signing values.
5. Key workflow concurrency by commit SHA so rapid pushes do not replace a pending bump; key the EAS job by version/build so the same release is serialized.
6. The GitHub workflow reports only whether the trigger was accepted. EAS owns build status and failure visibility; no additional notification channel is added.
7. Add a note to the active `expo-mobile-migration` change: a separate delivery change owns the EAS trigger, and routine Mobile CI remains check/bundle only.

## Risks / Trade-offs

- An EAS build failure is not a GitHub workflow failure.
- Re-running the workflow for the same version submits another pair of EAS builds.
- Android and iOS signing credentials must exist in EAS; the workflow cannot verify their presence or contents.
- The workflow does not prove native acceptance or store availability.
