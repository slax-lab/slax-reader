# Spec Delta

## Purpose

Give reader panel entry controls an immediate, truthful acknowledgement while initial application interaction or on-demand panel code is becoming ready.

## ADDED Requirements

### Requirement: Acknowledge panel activation before application readiness

When a visible reader panel entry is activated before the application can handle it, the reader SHALL immediately replace that entry's ordinary icon with a same-size loading indicator and retain the requested panel for that article. When interaction becomes ready, the reader SHALL submit the retained choice exactly once through its normal panel activation and access checks. Repeated activation of the same pending entry SHALL NOT create duplicate actions; choosing a different entry SHALL replace the pending choice. Navigating to another article SHALL discard the old pending choice.

#### Scenario: Activate Analysis during initial startup
- **WHEN** the initial article and Analysis entry are visible but application interaction is not ready, and the user activates Analysis
- **THEN** its icon shows loading feedback without waiting for the application bundle
- **AND** Analysis opens through the normal access checks once interaction is ready, without requiring a second click

#### Scenario: Replace or discard pending intent
- **WHEN** the user chooses another panel before startup completes
- **THEN** only the most recent panel choice remains pending and indicated as loading
- **AND** leaving that article before readiness prevents the pending choice from opening on another article

### Requirement: Reflect on-demand component loading at visible panel controls

While selected AI/Outline or Chat panel code is pending, its currently visible panel control SHALL show the loading indicator. A transition from the collapsed toolbar to expanded-panel tabs SHALL retain feedback at the corresponding visible control. Component completion, rejection, timeout, or denied activation SHALL end its visible busy state. Already available components SHALL NOT receive a mandatory loading interval. Content generation SHALL retain its own existing loading presentation rather than extending component-code loading feedback.

#### Scenario: Open a panel after interaction is ready
- **WHEN** the user activates Analysis or Chat and its component code is unavailable
- **THEN** the panel follows its existing opening behavior while its visible control shows loading
- **AND** its ordinary icon returns when the component becomes available

#### Scenario: Loading fails or access is denied
- **WHEN** component loading fails or times out, or normal access checks deny the requested action
- **THEN** the visible icon stops indicating loading
- **AND** the existing error, login, subscription, or retry presentation applies without granting additional access

#### Scenario: Switch away while code is loading
- **WHEN** the user switches panels or closes the sidebar while component code is pending
- **THEN** controls remain usable and the newly selected panel or closed state is preserved when the code arrives
- **AND** an unselected or closed panel does not display a stale active loading cue

### Requirement: Preserve control layout and accessible loading meaning

The feedback SHALL retain existing control dimensions, translated action names, keyboard activation, and focus visibility. The loading ring SHALL use the current theme's accent color; ordinary icons SHALL retain their existing control colors. Controls SHALL expose their busy meaning to assistive technology without making decorative loading geometry a duplicate action label. Light and dark themes SHALL support animated feedback; e-ink and reduced-motion modes SHALL use a distinguishable static loading cue. This SHALL apply at desktop, 768px, and narrow mobile widths wherever the existing panel entry is visible.

#### Scenario: Loading with reduced motion or e-ink
- **WHEN** an entry is pending in e-ink mode or with reduced motion requested
- **THEN** its loading state is visually distinguishable without continuous animation
- **AND** its action name and loading meaning remain available to assistive technology

### Requirement: Preserve surrounding reader contracts

The feedback SHALL preserve current authorization, subscription decisions, article positioning, loaded-panel layout, and content-area loading and error presentation. It SHALL NOT add artificial waiting, preload all panels, or delay readable article content.

#### Scenario: Normal reading while a panel is pending
- **WHEN** the user reads or navigates within an article while a panel entry is pending
- **THEN** feedback does not move the article or interfere with existing reading-position and navigation behavior
