# settings-labs-visibility Specification

## Purpose
Define which experimental feature controls appear in Web Settings without coupling presentation visibility to feature authorization or persisted user preferences.

## Requirements

### Requirement: Temporarily hidden Labs controls

Web Settings SHALL omit the YouTube videos (`youtube`) and PDF bookmarks (`pdf`) Labs rows and their interactive controls for every account, regardless of feature status, enabled state, or locale. Other translated Labs rows SHALL retain their existing order, labels, and toggle behavior. Features without translated names SHALL remain omitted.

#### Scenario: Mixed Labs response
- **WHEN** Settings loads YouTube, RSS, and PDF Labs features
- **THEN** only RSS appears from those three features, and its enable/disable control retains its existing behavior

#### Scenario: Hidden features are already enabled or graduated
- **WHEN** YouTube or PDF is enabled or marked as graduated in the loaded Labs response
- **THEN** its Settings row remains absent, including from keyboard navigation and the accessibility tree

#### Scenario: Untranslated and future features
- **WHEN** the response includes other feature keys
- **THEN** translated non-hidden features remain eligible for display and untranslated features remain absent

### Requirement: Settings visibility does not change entitlement

Filtering Settings SHALL NOT remove features from the account's loaded Labs state, modify stored preferences or enablement timestamps, or change save/upload authorization. Visiting Settings SHALL NOT issue an enable or disable request for a hidden feature. Existing access to saved bookmarks SHALL remain unchanged.

#### Scenario: Enabled preferences survive a Settings visit
- **WHEN** an account with YouTube or PDF enabled opens Settings
- **THEN** its loaded enabled state and enablement timestamp remain intact, no preference update is sent merely because the row is hidden, and existing feature consumers receive the same state

#### Scenario: Disabled preferences remain disabled
- **WHEN** an account without YouTube or PDF opt-in opens Settings or attempts a gated acquisition
- **THEN** hiding the control does not enable the feature or bypass its existing acquisition gate

#### Scenario: Remaining feature toggle fails
- **WHEN** saving an RSS toggle change fails
- **THEN** the control rolls back and reports its existing failure feedback without changing hidden features

### Requirement: Labs navigation matches visible content

Settings SHALL expose the Labs card and Features navigation destination only while at least one eligible Labs row exists. Hidden-only, untranslated-only, and empty responses SHALL leave no visible empty Features section, empty Labs card, or focusable navigation link to that section. Labs loading SHALL still occur when no visible rows are initially available.

#### Scenario: Only hidden rows are returned
- **WHEN** the loaded response contains only YouTube and PDF features
- **THEN** Settings shows neither the Labs card nor a visible Features heading or navigation link

#### Scenario: Visible Labs arrive asynchronously
- **WHEN** Settings initially has no loaded features and a later Labs response includes RSS
- **THEN** RSS and the Features navigation destination become available normally

### Requirement: Settings deep links remain safe

The existing `/user#labs` deep link SHALL navigate to the Labs card when visible rows exist and SHALL remain harmless when the card is absent. Other Settings navigation SHALL preserve query parameters, keyboard focus behavior, and destinations.

#### Scenario: Labs deep link with RSS
- **WHEN** the user opens `/user#labs` and an asynchronous response supplies a visible RSS row
- **THEN** the Labs card is displayed and reached through the existing section-navigation behavior

#### Scenario: Labs deep link without visible rows
- **WHEN** the user opens `/user#labs` and the response contains no eligible rows
- **THEN** Settings remains usable without an error, empty Labs card, or hidden focus destination
