# Spec Delta

## REMOVED Requirements

### Requirement: Temporarily hidden Labs controls

**Reason**: PDF was restored to Settings by `extension-support-pdf`, and YouTube saving and AI articles are now complete enough to be selectable. No Labs row remains intentionally hidden.

**Migration**: Labs visibility is defined by `All translated Labs controls are visible`. Existing enabled state, enablement timestamps, and save/upload gates are unchanged.

## ADDED Requirements

### Requirement: All translated Labs controls are visible

Web Settings SHALL show every Labs row returned by the account's Labs response that has a translated name, including `youtube`, `youtube_article`, `pdf`, `rss`, and `podcast`. Rows SHALL retain their response order, labels, and enable/disable behavior. Features without translated names SHALL remain omitted.

#### Scenario: Mixed Labs response
- **WHEN** Settings loads YouTube, YouTube AI article, RSS, and PDF Labs features
- **THEN** all four rows appear with their names, descriptions, and enable/disable controls

#### Scenario: YouTube rows are enabled or graduated
- **WHEN** YouTube videos or YouTube AI articles is enabled or marked as graduated in the loaded Labs response
- **THEN** its Settings row appears in the loaded state, and a graduated row keeps its disabled toggle

#### Scenario: Untranslated and future features
- **WHEN** the response includes other feature keys
- **THEN** translated features remain eligible for display and untranslated features remain absent

## MODIFIED Requirements

### Requirement: Settings visibility does not change entitlement

Showing Labs rows SHALL NOT remove features from the account's loaded Labs state, modify stored preferences or enablement timestamps, or change save/upload authorization. Visiting Settings SHALL NOT issue an enable or disable request for any feature. Existing access to saved bookmarks SHALL remain unchanged.

#### Scenario: Enabled preferences survive a Settings visit
- **WHEN** an account with YouTube enabled opens Settings
- **THEN** its loaded enabled state and enablement timestamp remain intact, no preference update is sent merely because the row is shown, and existing feature consumers receive the same state

#### Scenario: Disabled preferences remain disabled
- **WHEN** an account without YouTube opt-in opens Settings or attempts a gated acquisition
- **THEN** showing the control does not enable the feature or bypass its existing acquisition gate

#### Scenario: Remaining feature toggle fails
- **WHEN** saving an RSS toggle change fails
- **THEN** the control rolls back and reports its existing failure feedback without changing other features

### Requirement: Labs navigation matches visible content

Settings SHALL expose the Labs card and Features navigation destination only while at least one translated Labs row exists. Untranslated-only and empty responses SHALL leave no visible empty Features section, empty Labs card, or focusable navigation link to that section. Labs loading SHALL still occur when no visible rows are initially available.

#### Scenario: Only hidden rows are returned
- **WHEN** the loaded response contains only features without translated names
- **THEN** Settings shows neither the Labs card nor a visible Features heading or navigation link

#### Scenario: Visible Labs arrive asynchronously
- **WHEN** Settings initially has no loaded features and a later Labs response includes RSS
- **THEN** RSS and the Features navigation destination become available normally

### Requirement: Settings deep links remain safe

The existing `/user#labs` deep link SHALL navigate to the Labs card when translated rows exist and SHALL remain harmless when the card is absent. Other Settings navigation SHALL preserve query parameters, keyboard focus behavior, and destinations.

#### Scenario: Labs deep link with RSS
- **WHEN** the user opens `/user#labs` and an asynchronous response supplies a visible RSS row
- **THEN** the Labs card is displayed and reached through the existing section-navigation behavior

#### Scenario: Labs deep link without visible rows
- **WHEN** the user opens `/user#labs` and the response contains no translated rows
- **THEN** Settings remains usable without an error, empty Labs card, or hidden focus destination
