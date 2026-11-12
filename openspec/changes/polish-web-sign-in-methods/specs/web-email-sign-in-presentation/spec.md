# Web Email Sign-in Presentation

## Purpose

Give email sign-in a recognizable, compact, accessible presentation in the existing standalone Web login page and login modal while preserving their authentication and continuation behavior.

## ADDED Requirements

### Requirement: Email login retains its identity across presentation states

The email login module SHALL use an identifying decorative envelope beside its localized entry label. When expanded, it SHALL retain the method identity and present cancellation as a subordinate trailing action rather than a competing full-width primary control. Both existing login hosts SHALL use the same email module presentation and source order: Google, Apple when configured, then email. The collapsed email entry SHALL be visually subordinate to provider controls while retaining a clear label, identifying envelope, readable contrast, visible keyboard focus, and a minimum 44px hit area. Expanded Send/Verify actions SHALL remain clear stage actions. Surrounding content SHALL remain intact.

#### Scenario: An anonymous reader expands email sign-in

- **WHEN** a reader selects the email entry in a development, preview, or beta login page or modal
- **THEN** the expanded module retains its email identity above the form and exposes a clear cancellation action
- **AND** cancellation closes the form and retains the existing request-abort behavior

### Requirement: Email login controls fit compact and short viewports

Address entry and sending, and code entry and verification, SHALL each present a labelled input beside its submit action, with a minimum 44px control height. Status, errors, expiry, resend, and change-address actions SHALL remain readable without overlapping the control row. The module SHALL fit the existing card and modal at 320px and common phone widths in English and Chinese and light, dark, and e-ink themes. Modal controls SHALL remain reachable in the existing scrollable short-viewport surface.

#### Scenario: Email sign-in is used on a small phone

- **WHEN** the module is opened at 320px in either login host
- **THEN** the input and submit action remain beside one another without horizontal page/card overflow
- **AND** field labels, focus feedback, and available supporting actions remain perceivable

#### Scenario: Verification feedback increases modal height

- **WHEN** a code state or an error makes the content taller than the available modal viewport
- **THEN** the existing modal scroll container keeps submit, change-address, resend, legal, and dismissal controls reachable

### Requirement: Presentation preserves existing login contracts

The visual refinement SHALL preserve provider availability, invitation verification, development/preview/beta email visibility, account-safe cancellation, referral/acquisition context, post-login continuation, and the accepted account-binding form behavior. It SHALL use the existing Web design roles and curated icon boundary.

#### Scenario: A reader selects an existing provider during email sign-in

- **WHEN** the reader switches from an active email attempt to an available Google or Apple control
- **THEN** the existing provider initiation remains available and the abandoned email attempt is cancelled according to the existing lifecycle

#### Scenario: A production client renders login

- **WHEN** the login page or modal renders in production
- **THEN** email entry and its expanded form remain absent according to the rollout policy
- **AND** existing provider controls follow their previous configuration rules

#### Scenario: A preview or beta client offers the email flow

- **WHEN** an anonymous reader opens the Web login page or modal in the preview or beta profile
- **THEN** the email entry and compact code flow are available under the same client rules as development
- **AND** verification retains the existing session, cancellation, and continuation contracts

#### Scenario: A reader chooses a method without expanding email

- **WHEN** configured provider controls and collapsed email login are rendered
- **THEN** Google precedes Apple and email is last in both visual and keyboard order
- **AND** the email entry remains discoverable with lower visual emphasis than the provider controls
