# Spec Delta

## Purpose

Explain the benefits of a Slax Reader account inside the existing Web login modal while preserving its sign-in actions and supporting the Web locales, themes, and responsive layouts.

## ADDED Requirements

### Requirement: Login modal explains account benefits

The Web login modal SHALL display three localized benefits between its introductory copy and sign-in actions, in the requested order. The Simplified Chinese statements SHALL be “无限抓取保存与分享”, “在任何设备继续阅读”, and “建立自己的高质量、无干扰内容空间”. The English locale SHALL convey the same meanings.

#### Scenario: An anonymous visitor opens the Chinese login modal

- **WHEN** an anonymous visitor triggers an existing action that opens the login modal in Simplified Chinese
- **THEN** the modal displays all three exact Chinese statements in order above the sign-in actions
- **AND** its current heading, subtitle, legal links, available providers, and post-login destination remain unchanged

#### Scenario: An anonymous visitor opens the English login modal

- **WHEN** an anonymous visitor opens the modal in English
- **THEN** all three benefits are displayed in English without untranslated locale keys

### Requirement: Benefits use a compact and accessible visual treatment

The benefits SHALL appear in a left-aligned rounded tinted panel with one accent checkmark per statement, following the supplied reference and the Web design contract. Decorative checkmarks SHALL NOT duplicate spoken content. The panel SHALL remain readable in light, dark, and e-ink themes, and text SHALL wrap without hiding sign-in actions or overflowing the viewport.

#### Scenario: A visitor views the modal at supported widths

- **WHEN** the modal is shown at desktop width, the 768px transition, or 320px narrow width
- **THEN** the three benefits remain readable, longer text wraps inside the panel, and the sign-in and close controls remain reachable

#### Scenario: A visitor uses another Web theme

- **WHEN** the modal is displayed in light, dark, or e-ink mode
- **THEN** the panel, text, and checkmarks use the theme's semantic colors and remain distinguishable

#### Scenario: Existing provider availability and dismissal are exercised

- **WHEN** the modal is opened with or without Apple OAuth configuration and then dismissed
- **THEN** Google sign-in remains available, Apple sign-in follows the existing configuration rule, and dismissal preserves the existing scroll-unlock behavior

### Requirement: Surrounding modal follows the Web design contract

The modal SHALL use the semantic Web typography, elevation, blur, and motion roles. Secondary text SHALL remain readable across supported themes. Its close control SHALL have a localized accessible name, and interactive controls SHALL expose visible keyboard focus. Layout insets SHALL accommodate device safe areas while preserving access to scrollable content.

#### Scenario: A visitor navigates with a keyboard

- **WHEN** the close button, a provider button, or a legal link receives keyboard focus
- **THEN** the focused control displays a visible focus indicator

#### Scenario: A visitor requests reduced motion

- **WHEN** the visitor enables prefers-reduced-motion
- **THEN** the modal and its controls do not use nonessential transitions or entrance/press transforms

#### Scenario: A visitor uses a short screen with safe-area insets

- **WHEN** modal content exceeds the available viewport height
- **THEN** the card scrolls inside the overlay's safe-area-aware insets, and its controls remain reachable
