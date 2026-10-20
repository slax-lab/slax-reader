# Spec Delta

## Purpose

Make early article content available for prompt rendering while bounding image prioritization and preserving saved article markup, resource identity, and reading behavior.

## ADDED Requirements

### Requirement: Prioritize one early substantive article image

When the article loading policy is enabled, rendered non-PDF article markup SHALL assign eager loading and high fetch priority to at most one eligible early substantive image. Remaining article images SHALL retain lazy loading without application-assigned high priority. Selection SHALL exclude images identifiable from saved markup as hidden, tracking pixels, icons, or avatars, and SHALL NOT prioritize a late image merely because it is the first image in a text-heavy article. Selection SHALL be identical for equivalent raw, server class-isolated, browser-restored, and client-refreshed content and SHALL NOT depend on client mounting or viewport measurement. A visually substantive image SHALL NOT be excluded solely because it is hidden from assistive technology. Responsive images whose source can change during existing startup normalization SHALL retain the established lazy behavior in this release.

#### Scenario: Early image follows a source icon
- **WHEN** an article begins with an identifiable small source icon followed by an eligible substantive image
- **THEN** only the substantive image receives eager loading and high fetch priority
- **AND** the icon and later images do not receive high fetch priority

#### Scenario: Text-heavy opening or no eligible image
- **WHEN** the opening content contains no eligible substantive image
- **THEN** no image receives high fetch priority
- **AND** later article images remain lazy

#### Scenario: Server-rendered article and hydration
- **WHEN** the same article is server rendered and then hydrated
- **THEN** the chosen image already has its loading policy in the initial HTML response
- **AND** hydration does not change the chosen resource or priority policy

#### Scenario: Client navigation or refreshed body
- **WHEN** the reader loads a different article body through client navigation or a content refresh
- **THEN** the same deterministic selection rules apply before that body is inserted
- **AND** the previous article's choice is not reused

#### Scenario: Server presentation classes differ from saved classes
- **WHEN** server rendering adds the existing class-isolation prefix to an identifiable icon or avatar before a substantive image
- **THEN** the icon remains excluded on both server and client navigation
- **AND** its saved and rendered classes are not rewritten by the loading policy

#### Scenario: Browser repairs article HTML
- **WHEN** browser parsing repairs malformed markup, including moving images around a table
- **THEN** server and client choose the same image in the resulting visual content tree
- **AND** hydration does not change image priority or replace the body because of policy disagreement

#### Scenario: Responsive source normalization
- **WHEN** an image has a responsive source set or receives one from its picture source
- **THEN** the loading policy retains lazy loading for that image and preserves its responsive attributes
- **AND** it does not advance a request that the existing image processor will replace with another resource
- **AND** when that image is the first otherwise substantive candidate, no later image is promoted merely because it has a simpler source

### Requirement: Preserve article content and media identity

The policy SHALL modify only image loading and fetch-priority attributes. It SHALL preserve source URLs including signatures, responsive-source attributes, dimensions, styles, text, element order, and selection anchors. Reapplying it SHALL be idempotent, and conflicting duplicate loading attributes SHALL NOT be introduced. It SHALL NOT grant trust to unsanitized HTML or bypass existing media validation.

#### Scenario: Signed image with author dimensions
- **WHEN** a saved WeChat image has a signed proxy URL and an authored display-size constraint
- **THEN** applying the loading policy preserves the URL, constraint, aspect behavior, and surrounding markup

#### Scenario: Existing loading attributes
- **WHEN** an image already has loading or fetch-priority attributes, including duplicate or mixed-case forms
- **THEN** the result contains one effective value for each policy-owned attribute
- **AND** applying the policy again produces the same output

#### Scenario: Unsupported or unparseable content
- **WHEN** content cannot be transformed safely, or belongs to an excluded PDF or custom-media presentation
- **THEN** the reader retains its established rendering fallback
- **AND** it does not blank the body or guess a high-priority resource

### Requirement: Image setup is independent of load event timing

Eligible image previews, settled loading state, existing display rules, and failure handling SHALL work whether an image completes before or after the reader installs its handlers. Repeated setup or repeated completion handling SHALL NOT duplicate preview callbacks, restore a settled loading indicator, or broaden preview eligibility. This lifecycle correctness SHALL also hold with image prioritization disabled.

#### Scenario: Cached image completes before reader setup
- **WHEN** an eligible image has already completed successfully before reader setup
- **THEN** it receives the same completion/display handling and usable preview as a future-loaded image
- **AND** its loading indicator is cleared

#### Scenario: Failed image is already complete
- **WHEN** an image has already failed before reader setup
- **THEN** it reaches the existing failed-image presentation without remaining in a loading state
- **AND** later valid reloads can recover without stale failure or duplicate preview callbacks

#### Scenario: Repeated setup does not change eligibility
- **WHEN** setup repeats for a tracking image, an image previously excluded from preview, or a valid previewable image
- **THEN** existing eligibility is preserved and a click invokes at most one preview callback
- **AND** existing WeChat and custom-media display behavior remains intact

### Requirement: Loading optimization is independently reversible

The article policy SHALL be independently disableable at build time without modifying saved content, image URLs, or database state. Disabling it SHALL restore the previous application loading-attribute policy. Lifecycle correctness remains in effect; removing implementation costs or reverting lifecycle behavior requires a code/deployment rollback. Release verification SHALL demonstrate the effective policy on fresh and cached article responses before claiming rollback completion.

#### Scenario: Policy disabled for rollback
- **WHEN** a build disables article image prioritization
- **THEN** the reader uses its previous article loading behavior
- **AND** the public-page startup policy can remain enabled independently

#### Scenario: Cached HTML overlaps a rollback
- **WHEN** an older cached article response remains available after a switch-disabled deployment
- **THEN** rollout verification distinguishes its build from the new deployment and excludes it from the new-build comparison
- **AND** rollback is not declared complete until fresh and warmed responses converge and referenced assets remain available
