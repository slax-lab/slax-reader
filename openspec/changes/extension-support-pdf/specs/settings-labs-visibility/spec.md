# Spec Delta

## Purpose

Restore the PDF bookmarks Labs row in Web Settings so users can opt in to saving PDFs from the Extension, while YouTube videos stays hidden.

## MODIFIED Requirements

### Requirement: Temporarily hidden Labs controls

Web Settings SHALL omit the YouTube videos (`youtube`) Labs row and its interactive control for every account, regardless of feature status, enabled state, or locale. The PDF bookmarks (`pdf`) row SHALL be shown and toggled like any other translated Labs row. Other translated Labs rows SHALL retain their existing order, labels, and toggle behavior. Features without translated names SHALL remain omitted.

#### Scenario: Mixed Labs response
- **WHEN** Settings loads YouTube, RSS, and PDF Labs features
- **THEN** RSS and PDF bookmarks appear, YouTube does not, and each visible control retains its existing enable/disable behavior

#### Scenario: Hidden features are already enabled or graduated
- **WHEN** YouTube is enabled or marked as graduated in the loaded Labs response
- **THEN** its Settings row remains absent, including from keyboard navigation and the accessibility tree

#### Scenario: PDF bookmarks can be turned on
- **WHEN** an account without PDF opt-in opens Settings and turns on PDF bookmarks
- **THEN** the existing enable request is sent for `lab:pdf`, a failed request rolls the control back with the existing failure feedback, and the Extension can then save PDFs for that account

#### Scenario: Untranslated and future features
- **WHEN** the response includes other feature keys
- **THEN** translated non-hidden features remain eligible for display and untranslated features remain absent

### Requirement: Settings visibility does not change entitlement

Filtering Settings SHALL NOT remove features from the account's loaded Labs state, modify stored preferences or enablement timestamps, or change save/upload authorization. Visiting Settings SHALL NOT issue an enable or disable request for a hidden feature. Existing access to saved bookmarks SHALL remain unchanged.

#### Scenario: Enabled preferences survive a Settings visit
- **WHEN** an account with YouTube enabled opens Settings
- **THEN** its loaded enabled state and enablement timestamp remain intact, no preference update is sent merely because the row is hidden, and existing feature consumers receive the same state

#### Scenario: Disabled preferences remain disabled
- **WHEN** an account without YouTube opt-in opens Settings or attempts a gated acquisition
- **THEN** hiding the control does not enable the feature or bypass its existing acquisition gate

#### Scenario: Remaining feature toggle fails
- **WHEN** saving an RSS toggle change fails
- **THEN** the control rolls back and reports its existing failure feedback without changing hidden features

### Requirement: Labs navigation matches visible content

Settings SHALL expose the Labs card and Features navigation destination only while at least one eligible Labs row exists. Hidden-only, untranslated-only, and empty responses SHALL leave no visible empty Features section, empty Labs card, or focusable navigation link to that section. Labs loading SHALL still occur when no visible rows are initially available.

#### Scenario: Only hidden rows are returned
- **WHEN** the loaded response contains only the YouTube feature
- **THEN** Settings shows neither the Labs card nor a visible Features heading or navigation link

#### Scenario: PDF is the only visible row
- **WHEN** the loaded response contains only YouTube and PDF features
- **THEN** the Labs card and Features navigation destination are shown with the PDF bookmarks row

#### Scenario: Visible Labs arrive asynchronously
- **WHEN** Settings initially has no loaded features and a later Labs response includes RSS
- **THEN** RSS and the Features navigation destination become available normally
