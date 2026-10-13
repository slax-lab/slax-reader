# Slax Reader Design Contract

Status: **normative for UI design and implementation**

This document is the single design contract for Slax Reader. It defines the visual intent, application profiles, semantic boundaries, exceptions, and maintenance workflow that humans and coding agents must follow when changing user interfaces.

The contract does not duplicate every runtime value. Executable values remain in application-owned token files. The archived prototype under `docs/design/reference/` is evidence and visual context, not a specification.

Deferred design-system work is tracked in [`docs/design/backlog.md`](docs/design/backlog.md). The backlog is planning guidance; it does not turn every remaining inline SVG or legacy token into a migration requirement.

## 1. Scope and reading order

This contract applies to:

- the reader Web application in `apps/web`;
- the browser Extension in `apps/extension`;
- shared UI assets introduced for both applications;
- UI-related tests, tooling, screenshots, and generated renderers.

Before changing UI code:

1. Read this contract.
2. Identify the application profile and renderer involved.
3. Inspect that application's runtime tokens and nearby components.
4. Check the theme-support matrix and documented exceptions.
5. Use the archived prototype only for visual context or provenance.

Public article content, third-party iframes, email markup, Open Graph/Satori output, charts, and Shadow DOM surfaces may have renderer-specific constraints. They still follow the semantic intent where practical, but must not inherit global application CSS blindly.

## 2. Authority and conflict resolution

| Source | Authority |
| --- | --- |
| `DESIGN.md` | Semantic intent, permitted variants, accessibility requirements, application profiles, exceptions, and change workflow |
| `apps/web/styles/theme.tokens.css` | Current executable values for the Web core theme |
| `apps/web/app/assets/styles/fork.tokens.css` | Current executable values for Web-only business surfaces and known theme debt |
| Extension-owned styles | Current executable values for the Extension profile |
| UnoCSS configuration | A selective utility bridge over runtime tokens |
| `docs/design/reference/` | A provenance-stamped, non-normative design snapshot |
| Vue components and pages | Consumers of the contract; existing code may contain legacy exceptions |

`DESIGN.md` governs intended semantics. Application token files govern the values that execute those semantics. A mismatch is a defect or an intentional design change and must be reconciled in the same change:

- fix runtime code when it violates the current contract;
- update this contract and the runtime owner together when the intended design decision changed;
- record an explicit exception when a renderer cannot implement the common rule yet.

Do not create a second normative `design.md` under `docs/`. Supporting documents may index, audit, or explain the contract, but must link back here.

## 3. Product character

Slax Reader should feel calm, focused, and durable during long reading sessions.

- Reading content has priority over application chrome.
- Warm paper surfaces and restrained accent color define the Web profile.
- Density remains compact enough for a library while preserving clear targets and hierarchy.
- Motion explains state changes and never becomes decoration.
- E-ink mode removes effects that cause ghosting or reduce contrast.
- Brand surfaces may be expressive, but functional controls remain predictable.

Consistency means preserving semantic roles and interaction behavior. It does not require the Web and Extension to share identical colors, dimensions, or density.

## 4. Application profiles

### 4.1 Shared semantic layer

Both UI applications share these concepts:

- background, surface, text, muted text, border, accent, danger, and selection roles;
- primary, secondary, destructive, disabled, hover, focus, selected, and loading states;
- readable typography, visible keyboard focus, sufficient contrast, and labelled controls;
- icons whose meaning remains stable across placements;
- reduced-motion behavior and safe-area-aware layouts where applicable.

Shared semantics do not imply a shared implementation package. Keep assets and tokens application-owned until at least two applications consume the same API without profile-specific branching.

### 4.2 Web profile

The Web application uses a warm paper visual system with light, dark, and e-ink modes. Its core runtime contract lives in `apps/web/styles/theme.tokens.css`.

- All new core-shell and reading UI must use `--slax-*` semantic tokens.
- Core theme tokens must provide light, dark, and e-ink values when the semantic role appears in all three modes.
- `theme.tokens.css` contains declarations only because it is also injected into article-preview contexts.
- Global selectors, media queries, and e-ink effect suppression belong in `apps/web/styles/theme.css` or another host-only stylesheet.
- `apps/web/app/assets/styles/fork.tokens.css` contains product-specific roles. Literal values there are allowed when they represent a distinct business or data-visualization meaning.

### 4.3 Extension profile

The Extension currently uses a compact, fixed-dark interface with its own typography, dimensions, and surface values. It is a separate profile, not an incomplete copy of the Web theme.

- Preserve the Extension's compact density unless a reviewed design change says otherwise.
- Do not import the Web token file or silently replace Extension values with Web values.
- New repeated Extension colors or dimensions should gain Extension-owned semantic variables.
- A future shared token package must expose shared roles and profile-specific values rather than forcing one application's palette onto the other.

## 5. Tokens and utilities

### 5.1 Token rules

- Use semantic names that describe purpose rather than a raw color or one component.
- Web tokens use the private `--slax-*` prefix.
- Reuse an existing role before adding a new token.
- Add a token when a value is repeated, theme-dependent, or expresses a stable product meaning.
- Keep component-local measurements local when sharing them would create a false global contract.
- Avoid new hard-coded colors in changed UI code when an applicable semantic token exists.
- Renderer constraints, brand colors, charts, third-party content, and intentionally fixed-profile surfaces may use documented literals.

Existing literals are migration debt, not evidence that new literals are preferred. Enforcement should initially prevent new violations or use a reviewed baseline instead of failing the entire historical codebase.

### 5.2 UnoCSS bridge

UnoCSS exposes only tokens that benefit from utility-class consumption. A token does not need an UnoCSS mapping merely because it exists.

Add or change a mapping when:

- multiple templates need the utility;
- the utility improves semantic readability; and
- the mapping preserves the token's meaning.

Tokens used through direct CSS, pseudo-elements, generated content, complex filters, or JavaScript may remain outside the bridge.

### 5.3 Typography

The Web profile uses:

- `--slax-font-sans` for interface and body text;
- `--slax-font-serif` for editorial headings and selected brand treatments;
- `--slax-font-mono` for code.

Playfair Display is self-hosted for supported Latin ranges. Inter is currently the preferred sans-serif name but is not self-hosted by the application, so the actual rendering may use the platform sans-serif fallback. Do not claim pixel-identical Inter rendering until the font is deliberately shipped and reviewed.

Use the existing semantic Web type scale: display, h2, brand, card, body, meta, auxiliary, and tag. A component may use another size only when its renderer or compact profile requires it and the reason is local and clear.

### 5.4 Shape, elevation, and motion

- Core Web radii and shadows come from theme tokens.
- E-ink mode removes shadows, blur, transitions, and animation that can cause ghosting.
- Respect `prefers-reduced-motion` for nonessential motion.
- Use the standard duration and easing tokens for recurring Web transitions.
- Do not add a global animation or transition to embedded article content.

### 5.5 Layout and responsive behavior

The Web core layout treats `768px` as its primary mobile transition. Individual product flows currently use additional renderer-specific breakpoints; keep those local until they are deliberately consolidated.

- Use the existing shell, content, sidebar, side-panel, and header tokens for core Web layout.
- Preserve safe-area padding on mobile devices.
- Do not infer that a reference mockup represents every supported viewport.
- Validate changed layouts at desktop, the primary `768px` transition, and the component's narrowest supported width.

## 6. Theme-support matrix

| Surface | Current obligation |
| --- | --- |
| Web application shell and core reading UI | Light, dark, and e-ink are required for new work |
| Snapshot and bookmark detail UI | Follow core themes where core tokens are consumed; verify every changed state |
| Dashboard and data visualization | Profile-specific colors are allowed; current theme coverage must be verified locally |
| Payment, subscription, invite, collection-management, and import flows | Light-biased legacy/fork styling; do not claim complete dark or e-ink support |
| Public article iframe and Shadow DOM content | Inject only the scoped token declarations needed by the renderer |
| Open Graph, Satori, canvas, charts, and exported images | Renderer-owned palette; document deliberate fixed colors |
| Extension | Fixed-dark profile until a separate reviewed theme change is implemented |
| Brand and service logos | Preserve approved fixed colors unless a monochrome variant is explicitly supplied |

When touching a legacy row, preserve current behavior or create an OpenSpec change for the visible theme migration. Do not broaden an unrelated task into an unreviewed theme rewrite.

## 7. Icons and visual assets

### 7.1 Reference snapshot

`docs/design/reference/slax-reader-design-system/` preserves a fixed prototype snapshot. Its icon README describes a broader historical inventory than the files actually present. Missing listed files must not be treated as available runtime assets.

The snapshot:

- is non-normative;
- may contain inline SVGs that are not separate files;
- preserves original relative paths;
- includes remote-font and JavaScript behavior in the archived HTML;
- must not be copied into production bundles as a directory.

### 7.2 Runtime categories

Runtime icon metadata must distinguish at least:

- `inline`: trusted SVG geometry rendered inside an application-owned `<svg>`;
- `mask`: monochrome geometry consumed as a CSS mask;
- `brand`: approved fixed-color artwork;
- `raster`: PNG or another bitmap asset.

Do not send all categories through one `v-html` renderer. A runtime registry must record the `viewBox`, default size, paint behavior, accessibility behavior, and provenance for each imported icon.

### 7.3 SVG import boundary

Cross-repository SVGs must be validated at build time before runtime use. Reject:

- scripts and active embedded content;
- `on*` event attributes;
- `foreignObject`;
- external or data-URL `href` and `xlink:href` references;
- missing `viewBox` declarations;
- undocumented fixed paint when `currentColor` is expected.

The archived reference is not automatically trusted runtime markup. Runtime SVG markup must be curated into the application and reviewed like code.

### 7.4 Size and accessibility

The common reference sizes are 12, 14, 15, 16, 17, 18, 20, 24, and 32 pixels. Fifteen- and seventeen-pixel artwork support compact menu and toolbar actions; ten-pixel artwork is a special compact case, not a general interactive target. Control hit areas are larger than their icons.

- Decorative icons default to `aria-hidden="true"`.
- A surrounding button or link owns the accessible name when it already describes the action.
- Standalone meaningful artwork needs an accessible label or equivalent text.
- Avoid duplicate screen-reader output from both an icon title and its labelled control.
- Verify stroke weight and optical alignment at the actual rendered size.

## 8. Components and states

Every changed interactive component must account for:

- rest, hover, active, selected, disabled, loading, and error states where applicable;
- keyboard focus with a visible `:focus-visible` treatment;
- pointer and touch target size;
- reduced-motion behavior;
- text expansion and localization;
- theme/profile coverage from the matrix above.

Prefer existing component patterns in the same application. If nearby implementations conflict, use this contract and the current token layer to choose intentionally, then record a narrowly scoped exception when migration is outside the task.

## 9. Exceptions

An exception is acceptable when it is required by a renderer, brand asset, third-party surface, visualization palette, compact Extension context, or an explicitly deferred legacy migration.

Exceptions must be:

- local rather than global;
- named by semantic purpose;
- documented near the token or renderer;
- covered by a focused check when regression risk is material;
- removed when the underlying constraint no longer exists.

Avoid generic escape hatches such as `misc`, `special`, or `temporary-color`.

## 10. Change workflow

For every design-related change:

1. Identify the application profile and renderer.
2. Confirm the intended semantic role in this contract.
3. Reuse or update the application-owned runtime token.
4. Add an UnoCSS bridge only when utility consumption benefits.
5. Check all required states, viewport transitions, and themes for the affected surface.
6. Update this contract when semantic intent or an allowed exception changes.
7. Update the reference snapshot only from a fixed source commit and regenerate its manifest.

Documentation, reference snapshots, agent rules, and non-behavioral validation may use `OpenSpec: n/a`. Any visible change to color, spacing, icon rendering, accessible naming, interaction, or theme behavior requires the repository's OpenSpec proposal and review flow before implementation.

## 11. Agent checklist

Before completing UI work, an agent must be able to answer:

- Which profile and renderer does this change affect?
- Which source owns the semantic decision and which file owns the executable value?
- Does the change introduce a raw value where a semantic token exists?
- Which themes and responsive widths were verified?
- Is an icon decorative, labelled by its control, or independently meaningful?
- Does imported SVG content pass the active-content boundary?
- Is the archived prototype being used only as reference?
- Does the change alter observable behavior and therefore require OpenSpec?

## 12. Related files

- `docs/design/README.md` — index and maintenance entry point
- `docs/design/backlog.md` — bounded follow-up work and completion criteria
- `docs/design/reference/slax-reader-design-system/SOURCE.md` — reference provenance and limitations
- `apps/web/styles/theme.tokens.css` — Web core runtime tokens
- `apps/web/styles/theme.css` — Web host-level theme behavior
- `apps/web/app/assets/styles/fork.tokens.css` — Web product-specific roles and theme debt
- `apps/web/uno.config.ts` — selected Web utility mappings
- `apps/extension/uno.config.ts` — Extension utility configuration
