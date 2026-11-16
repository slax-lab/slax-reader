# Spec Delta

## Purpose

Keep quoted tweets in Web article detail pages visually consistent with the active reading theme and readable when their descriptions wrap across multiple lines.

## ADDED Requirements

### Requirement: Quoted tweets follow the reading theme

Quoted-tweet cards in Web article detail pages SHALL use the active Web theme's semantic accent background for hover feedback in light, dark, and e-ink modes. This presentation correction SHALL preserve the existing quote content and link destination.

#### Scenario: Hovering a quoted tweet

- **WHEN** a reader hovers a quoted-tweet card in a supported Web theme
- **THEN** the card uses that theme's accent background instead of a fixed pale-blue background
- **AND** moving away restores its existing resting background

#### Scenario: Opening a quoted tweet

- **WHEN** a reader activates the quoted-tweet link
- **THEN** the existing quote destination opens with the existing link behavior

### Requirement: Quoted-tweet descriptions have readable line spacing

Quoted-tweet descriptions SHALL retain their 14px metadata font size and use a 20px line height, including multiline Chinese and English content at narrow mobile, 768px, and desktop widths.

#### Scenario: Description wraps on a narrow screen

- **WHEN** a quoted-tweet description wraps across multiple lines
- **THEN** its lines remain readable at a 20px line height without horizontal overflow
- **AND** article body typography and the quote card's other spacing remain unchanged
