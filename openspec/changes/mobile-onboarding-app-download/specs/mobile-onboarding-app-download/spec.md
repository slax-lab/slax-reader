# Spec Delta

## Purpose

Provide a usable onboarding path for mobile web visitors who cannot install the Slax Reader browser extension, while preserving a durable manual exit from onboarding.

## ADDED Requirements

### Requirement: Mobile onboarding promotes the Slax Reader app

When onboarding is rendered in a supported mobile browser, the system SHALL show app-download guidance instead of browser-extension installation, pinning, or extension-detection instructions.

#### Scenario: Android mobile visitor

- **WHEN** an Android browser opens onboarding
- **THEN** the onboarding shows mobile app copy and a download-app action
- **AND** it does not show the browser-extension installation tutorial

#### Scenario: iPhone or iPad visitor

- **WHEN** an iOS or iPadOS browser opens onboarding
- **THEN** the onboarding shows mobile app copy and a download-app action
- **AND** it does not show the browser-extension installation tutorial

#### Scenario: Desktop visitor

- **WHEN** a desktop browser opens onboarding
- **THEN** the existing extension installation and configuration flow remains available

### Requirement: Mobile download navigation uses the appropriate official destination

The mobile download action SHALL open a new browser tab. It SHALL target the official iOS App Store listing for iOS/iPadOS, the official Google Play listing for Android, and the official Slax Reader Reader page when the platform is mobile but cannot be identified.

#### Scenario: iOS download

- **WHEN** an iOS or iPadOS user activates the mobile download action
- **THEN** a new tab opens `https://apps.apple.com/us/app/slax-reader-ai-read-it-later/id6596730998`

#### Scenario: Android download

- **WHEN** an Android user activates the mobile download action
- **THEN** a new tab opens `https://play.google.com/store/apps/details?id=com.slax.reader`

#### Scenario: Unknown mobile platform

- **WHEN** a mobile browser cannot be classified as iOS/iPadOS or Android
- **THEN** a new tab opens `https://www.slax.com/reader/`

### Requirement: Mobile users can close onboarding manually

Mobile onboarding SHALL expose a visible, accessible close action. Activating it SHALL persist the account's existing onboarding dismissal state before navigating to the root Inbox, so the same account is not immediately redirected back into onboarding.

#### Scenario: Close mobile onboarding

- **WHEN** a mobile user activates the close action
- **THEN** onboarding records the account dismissal marker
- **AND** the user is returned to `/`
- **AND** a subsequent onboarding eligibility check does not re-open onboarding for that account

#### Scenario: Missing account identity

- **WHEN** the account identity is not available while the close action is activated
- **THEN** the page still performs its safe root navigation without throwing

### Requirement: Mobile onboarding is localized and accessible

Mobile onboarding copy and controls SHALL be available in the existing English and Chinese locales. The download and close controls SHALL have accessible names, keyboard focus, and touch targets consistent with the Web design contract.

#### Scenario: Locale rendering

- **WHEN** the app locale is English or Chinese
- **THEN** the mobile title, explanatory copy, download action, and close action use the matching locale

