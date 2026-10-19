# Tasks

## 1. Mobile routing and presentation

- [x] 1.1 Add client-safe mobile platform URL selection using the verified App Store, Google Play, and Reader fallback URLs; verify iOS, Android, iPadOS, and unknown mobile user-agent cases with unit tests.
- [x] 1.2 Add the mobile onboarding branch to the hero with app guidance, a new-tab download link, and a visible close control; verify extension steps remain unchanged on desktop.
- [x] 1.3 Keep close navigation on the existing parent `skip` event and verify the per-account dismissal marker is written before root navigation.

## 2. Localization and accessibility

- [x] 2.1 Add English and Chinese mobile onboarding strings and verify rendered controls have accessible names and keyboard/touch-friendly targets.
- [x] 2.2 Correct the narrow-screen close-control layout and verify desktop, 768px, and narrow mobile widths using the Web design contract.

## 3. Validation

- [x] 3.1 Extend onboarding page and hero unit tests for mobile rendering, URL selection, new-tab attributes, and manual close emission.
- [x] 3.2 Run targeted Web tests, `openspec validate --all --strict`, and the repository local review required by `REVIEW.md`; resolve any Important findings before proposing the PR.

## Validation evidence

The user approved implementation and PR creation after reviewing the proposal.

- Targeted onboarding, dismissal, and environment tests: 60 passed across four files. New mobile cases failed before implementation and passed afterward.
- Full Web unit suite: 2,140 passed, three skipped across 198 files. Type checking with `vue-tsc --noEmit -p .nuxt/tsconfig.app.json` passed after preparing Nuxt types. Both checks used explicit non-secret localhost runtime configuration; no secret files were read or added.
- Changed-file ESLint: zero errors, one existing unused-argument warning in the onboarding page test. `git diff --check` passed.
- `openspec validate --all --strict`: 40 items passed, zero failed.
- Browser component checks used the real hero, environment helper, locale messages, and theme styles in a temporary harness with a stub header. At 320px, Chinese light/e-ink and English dark layouts had no horizontal overflow; both actions stayed visible with targets at least 48px high. The 768px mobile layout and 1280px desktop extension layout also passed. Keyboard Tab showed a visible focus outline, and Enter on close emitted the exit action.
- The browser harness does not replace authenticated end-to-end or physical-device testing. Account dismissal and root navigation were verified by page integration tests; store destinations and new-tab attributes were verified without installing an app.
- Independent local review completed the Bugs, Security, and Compliance passes in `REVIEW.md`: no Important findings or Nits.
