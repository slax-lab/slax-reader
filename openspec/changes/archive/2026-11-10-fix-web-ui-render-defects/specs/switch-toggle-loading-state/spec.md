# Spec Delta

## Purpose

Keeps the shared `SwitchToggle` control's knob visible and correctly positioned throughout a loading request, in every build profile (development, preview, beta, production).

## ADDED Requirements

### Requirement: The knob stays visible while loading

`SwitchToggle` MUST keep its knob's surface background and shadow visible for the entire duration a `loading` prop is true. A loading spinner MAY render as an overlay on top of the knob, but MUST NOT replace or hide the knob's own visual state.

#### Scenario: Toggling a fast request

- **WHEN** the user clicks a switch whose `change` handler resolves quickly (for example a Labs feature toggle or the share-link switch)
- **THEN** the knob's surface remains visible throughout the request, with at most a spinner overlay, and never disappears or flashes empty

#### Scenario: Toggling a slow request

- **WHEN** the user clicks a switch whose `change` handler is still pending
- **THEN** the knob shows a visible spinner overlay while keeping its own surface background and shadow, until the request settles

### Requirement: The knob's on/off position renders correctly in every build profile

`SwitchToggle`'s on/off position MUST render identically — using the same computed `transform` — in `development`, `preview`, `beta`, and `production` builds. A local development server's build tooling MUST NOT serve CSS without the default custom-property values the on/off transform depends on.

#### Scenario: Toggling in a local development server

- **WHEN** the user clicks a switch while running the web app's local development server
- **THEN** the knob moves to its new on/off position exactly as it does in a `preview` or `production` build
