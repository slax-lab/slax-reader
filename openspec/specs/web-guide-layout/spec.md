# web-guide-layout Specification

## Purpose
Make the existing Web welcome guide readable and its primary action reachable across phone and desktop viewports while retaining its content and authentication behavior.

## Requirements

### Requirement: Phone guide fits the viewport

At viewport widths from 320px through 768px inclusive, `/guide` SHALL display the existing three tutorial cards vertically in order, allow localized headings and descriptions to wrap, and scale illustrations proportionally within their containers. Content SHALL remain readable without horizontal scrolling or clipping, and SHALL respect device safe areas.

#### Scenario: Narrow phone
- **WHEN** a user opens `/guide` at 320px or 390px in Chinese or English
- **THEN** the welcome text and all three ordered cards fit within the viewport and are reachable by vertical scrolling
- **AND** images retain their aspect ratios and remain fully visible

#### Scenario: Responsive boundary
- **WHEN** the viewport is 768px wide
- **THEN** the guide uses the phone arrangement
- **WHEN** the viewport increases to 769px
- **THEN** the guide uses the existing desktop arrangement

### Requirement: Guide actions remain reachable

The phone footer SHALL place its prompt and action vertically, keep controls within the available width with at least the existing 44px action height, and retain the existing authentication and navigation behavior.

#### Scenario: Signed-out guide
- **WHEN** a signed-out user reaches the guide footer on a phone
- **THEN** the login prompt and Google login button are fully visible and the button invokes the existing login action

#### Scenario: Signed-in guide
- **WHEN** a signed-in user reaches the guide footer on a phone
- **THEN** the existing start action is fully visible and retains its current destination

### Requirement: Existing desktop and theme presentation is preserved

Above 768px the guide SHALL retain its desktop arrangement and existing actions. Responsive changes SHALL use the Web semantic theme roles and remain readable in light, dark, and e-ink appearances.

#### Scenario: Desktop guide
- **WHEN** `/guide` is opened at 1440px
- **THEN** it retains the welcome row, horizontal tutorial cards, and inline footer

#### Scenario: Theme coverage
- **WHEN** the guide is viewed in light, dark, or e-ink mode on a phone
- **THEN** its text, card boundaries, and actions remain readable using the corresponding Web theme
