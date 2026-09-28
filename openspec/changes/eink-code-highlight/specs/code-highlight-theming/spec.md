# Spec Delta

## Purpose

Keeps syntax-highlighted code blocks — AI-chat answers first, any other markdown surface that renders code — visually consistent with the theme the reader has chosen, including the monochrome e-ink theme, whose panel characteristics make dark fills and color-coded syntax actively harmful rather than merely off-brand.

## ADDED Requirements

### Requirement: Code block colors follow the active theme

Code blocks in rendered markdown SHALL take their background, body text color and syntax colors from the active theme. No color in a code block may be fixed independently of the theme.

#### Scenario: Switching theme restyles an existing code block

- **WHEN** a reader viewing an AI answer that contains a fenced code block switches from one theme to another
- **THEN** the block's background, body text and syntax colors change to the new theme's values without a page reload and without re-requesting the answer

#### Scenario: Every color resolves from the theme

- **WHEN** the computed colors of a rendered code block are inspected in any theme
- **THEN** each of them resolves from that theme's code-highlight values, and none comes from a palette that is fixed regardless of theme

### Requirement: Every theme defines the complete code-highlight value set

Each theme (light, dark, e-ink) SHALL define every code-highlight value: background, body text, border, and one color per syntax role (comment, keyword, markup/tag name, literal constant, string, number, symbol/link, built-in name). A theme missing any of them SHALL fail the theme guard check instead of silently inheriting another theme's value.

#### Scenario: Guard check enforces coverage

- **WHEN** the theme guard check runs
- **THEN** it reports a failure if any theme block omits any code-highlight value

#### Scenario: A newly added syntax role cannot ship undefined

- **WHEN** a code-highlight value is added to the set
- **THEN** the guard check fails until all three themes define it

### Requirement: E-ink renders code blocks as paper

In the e-ink theme a code block SHALL render as a paper-like surface: the theme's surface color as background, a visible 1px border, and black body text. It MUST NOT paint a dark-filled region, and it MUST NOT use translucent colors.

#### Scenario: Code block is light in e-ink

- **WHEN** an AI answer containing a fenced code block is displayed in the e-ink theme
- **THEN** the block shows the theme surface color as its background with a visible 1px border and black body text, and no dark-filled region appears anywhere in the block

#### Scenario: No translucent colors in e-ink

- **WHEN** the computed colors of an e-ink code block are inspected
- **THEN** every one of them is an opaque color, with no alpha channel below fully opaque

#### Scenario: E-ink code block matches the article code block

- **WHEN** a reader page shows an article code block and a chat code block side by side in the e-ink theme
- **THEN** both use the same background color, border color and body text color

### Requirement: E-ink syntax differentiation is achromatic and legible

In the e-ink theme, syntax roles SHALL be differentiated only by grayscale value, font weight and font style — never by hue. Every syntax color SHALL meet a contrast ratio of at least 4.5:1 against the e-ink code background.

#### Scenario: Palette is achromatic

- **WHEN** the e-ink code-highlight syntax values are read
- **THEN** each one is a gray (its red, green and blue components are equal)

#### Scenario: Contrast floor is met

- **WHEN** the contrast ratio of each e-ink syntax color is computed against the e-ink code background
- **THEN** every one is at least 4.5:1

#### Scenario: Roles stay distinguishable without color

- **WHEN** a code block containing comments, keywords and string literals is displayed in the e-ink theme
- **THEN** comments, keywords and string literals are each visually distinguishable from body text and from one another

### Requirement: A code block paints one background layer

A code block SHALL paint its background exactly once, on the block container. The highlighted code element inside it SHALL NOT paint a second background, and no border, halo or lighter frame may appear between the block's edge and its code body.

#### Scenario: No second background layer

- **WHEN** a code block is rendered in any theme
- **THEN** the visible background from the block's outer edge to its text is uniformly the code background color, with no second layer, halo or inner frame

### Requirement: The code-block language label stays legible on the code surface

The language label that the shared markdown renderer emits inside the code block SHALL take its color from the code-highlight values rather than inheriting the page text color, and its contrast against the code background SHALL be at least 4.5:1 in every theme.

#### Scenario: Label legible in every theme

- **WHEN** a code block carrying a language tag is displayed in the light, dark or e-ink theme
- **THEN** the label's contrast against the code background is at least 4.5:1

#### Scenario: Label does not inherit the page text color

- **WHEN** the code-block stylesheet is inspected
- **THEN** the label element is given an explicit code-highlight color, so a future page-text change cannot make it unreadable against the code surface

### Requirement: Code text and code background travel together

Any element that takes the code text or syntax colors SHALL sit on the code background, and no surface may paint the code background without also giving that text the code color. This covers code markup that does not carry the block wrapper — a bare `<pre>` (mermaid placeholders, indented code blocks, raw HTML) and pre-rendered highlight markup.

#### Scenario: Unwrapped code markup is self-consistent

- **WHEN** highlight markup or a bare `<pre>` is rendered without the block wrapper
- **THEN** its text sits on the code background, rather than code-palette text on the page background or page-colored text on the code background

#### Scenario: A surface that paints the code background also colors its text

- **WHEN** a surface styles its own `<pre>` elements with the code background
- **THEN** it also gives them the code text color, so no such block shows the page text color on the code background

### Requirement: Light and dark keep their existing code-block appearance

In the light and dark themes, the code background, body text color and all syntax colors SHALL retain the values they had before this change. Their only visible deltas are structural: the block paints a single surface, and the language label — which now sits on that surface — takes the code text color.

#### Scenario: Light and dark palette is unchanged

- **WHEN** the same code block is rendered in the light theme and in the dark theme after this change
- **THEN** its background, body text color and syntax colors equal the values used before this change
