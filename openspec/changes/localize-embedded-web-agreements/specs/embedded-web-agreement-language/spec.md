## Purpose

Pass the active App display language on the existing agreement WebView entry and render both the page title and document body in that language.

## ADDED Requirements

### Requirement: Open the Terms and Privacy documents in the App's active language

The Web experience SHALL pass the active App display language on the existing agreement WebView entry and render both the page title and document body in that language.

#### Scenario: Chinese agreement tabs

- **WHEN** a reader in Chinese App login opens Terms and then Privacy with a fresh embedded browser session
- **THEN** both titles and substantive text, including the first and last section, use the Chinese documents

#### Scenario: English App in a Chinese browser

- **WHEN** the App language is English but the WebView has a previous Chinese preference
- **THEN** each linked agreement renders the English document and the active Web preference remains unchanged

#### Scenario: Ordinary Web visit

- **WHEN** a standalone visitor opens an agreement without a supported locale hint
- **THEN** the public document follows existing Web language selection
