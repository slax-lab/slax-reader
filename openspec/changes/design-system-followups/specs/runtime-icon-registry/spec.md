# Spec Delta

## MODIFIED Requirements

### Requirement: Rendering honors icon kind, size, paint, and accessibility metadata

The Web icon renderer SHALL choose the rendering mechanism from the registry kind. Inline icons SHALL render inside an application-owned SVG viewport using generated, validated inner geometry; mask icons SHALL render through a mask surface; and brand or raster icons SHALL render as image content while preserving their recorded intrinsic aspect ratio. The renderer SHALL apply the requested size while preserving the registry default when no size is supplied, SHALL not override documented brand paint, and SHALL follow the explicit accessibility mode rather than infer a parent control's accessible name. Every interactive control changed or migrated by this change that relies on an icon for its action SHALL expose an accessible name through visible text or an explicit `aria-label`; a `title` attribute alone SHALL not be the only naming mechanism. Registry default sizes SHALL match the default rendered size of each in-scope consumer unless the consumer supplies an explicit documented override.

#### Scenario: Decorative icon

- **WHEN** an icon with `decorative` mode is rendered
- **THEN** the icon is hidden from the accessibility tree with no title or label output

#### Scenario: Icon labelled by its surrounding control

- **WHEN** an icon with `control-labelled` mode is rendered inside a button or link
- **THEN** the icon is hidden from the accessibility tree and the surrounding control exposes its accessible name through visible text or an explicit `aria-label`

#### Scenario: Standalone meaningful icon

- **WHEN** an icon with `standalone` mode is rendered
- **THEN** the renderer exposes the registry label or an explicit caller label as the icon's accessible name, and fails visibly when neither is available

#### Scenario: Mask icon changes theme color

- **WHEN** a mask icon is rendered under a different Web theme
- **THEN** its geometry remains unchanged and its visible color follows the consuming semantic color

#### Scenario: Registry size matches its default consumer

- **WHEN** a consumer renders an icon without an explicit size
- **THEN** the icon uses the registry default size recorded for that consumer's normal layout, and a deliberate size override is covered by the migration matrix or component contract
