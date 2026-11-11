# Spec Delta

## Purpose

Start the resources needed for anonymous Web login without first loading the Inbox or unrelated promotion UI.

## ADDED Requirements

### Requirement: Anonymous Inbox entry resolves login before loading the Inbox view

The Web application SHALL defer the Inbox view until the route passes its existing authentication flow. Authenticated visits SHALL retain the current Inbox URL and campaign parameters.

#### Scenario: Anonymous root entry
- **WHEN** an anonymous visitor opens the root URL with campaign parameters
- **THEN** the application redirects to login without loading the Inbox view
- **AND** the established authentication continuation retains the destination and attribution

#### Scenario: Authenticated root entry
- **WHEN** an authenticated visitor opens the root Inbox
- **THEN** the Inbox view mounts at the root URL and retains its existing campaign behavior

### Requirement: Login starts only the required presentation resources

The Web login card SHALL render independently of the default layout promotion host and the optional invitation and browser hint components. Existing login actions, theme, and conditional invitation and browser hint behavior SHALL remain available.

#### Scenario: Ordinary browser opens login
- **WHEN** an anonymous visitor opens login in a standard browser without an invitation
- **THEN** the card renders without loading the default layout promotion host, invitation banner, or browser hint
- **AND** the initial document exposes the login route's required JavaScript and CSS before route resolution

#### Scenario: Conditional login presentation
- **WHEN** a visitor meets the established invitation or in-app browser hint conditions
- **THEN** the corresponding component can appear without delaying the ordinary login card

### Requirement: Login documents expose locale resources before application setup

The prerendered root and login documents SHALL allow the browser to request supported locale data before client route resolution. Existing locale selection and translated content SHALL remain under i18n control.

#### Scenario: Direct locale discovery
- **WHEN** a browser reads the initial login or root document
- **THEN** it can discover the generated locale resource URLs from that document
- **AND** i18n can reuse the matching request when it resolves the selected language
