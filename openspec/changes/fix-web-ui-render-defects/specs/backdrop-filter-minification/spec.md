# Spec Delta

## Purpose

Ensures that any Web surface requesting a backdrop blur (`backdrop-filter`) actually renders that blur in the compiled production bundle, not only in an unminified build.

## ADDED Requirements

### Requirement: A requested backdrop blur survives production CSS minification

A component or stylesheet rule that sets `backdrop-filter` MUST render that blur in the `production` and `beta` build profiles' compiled CSS, matching the visual effect it already renders in an unminified (`preview`/`development`) build. The source MUST NOT hand-write a `-webkit-backdrop-filter` declaration alongside the standard property in a way that causes the build's CSS minifier to drop the standard property.

#### Scenario: Visiting a surface with a backdrop blur in production

- **WHEN** a user visits a page that renders a surface styled with `backdrop-filter` (for example the `/b/[id]` shared-article bottom toolbar, a modal overlay, or a mobile notes entry) on the deployed `production` build
- **THEN** the surface renders its backdrop blur exactly as it renders in a `preview` build

#### Scenario: The E-ink theme still disables the blur

- **WHEN** a user viewing any such surface has the E-ink theme active
- **THEN** the surface renders with no backdrop blur, in both `preview` and `production` builds
