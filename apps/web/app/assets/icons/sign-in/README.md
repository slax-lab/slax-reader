# Account sign-in artwork

These curated SVGs come from dependencies already present in the Web application at the registry's provenance snapshot (`954ea26fc7e2d64dd0b01381459b04d691657df6`). Registry provenance points to the existing provider consumers or the dependency declaration at that snapshot; the source collection keys and exact installed versions used for this extraction are recorded below.

| File | Source | Author | License | Adaptation |
| --- | --- | --- | --- | --- |
| `google.svg` | `@iconify-json/logos` 1.2.14, `google-icon` | Gil Barbara / SVG Logos | CC0-1.0 | Add explicit source dimensions and viewBox; preserve fixed brand colors. |
| `apple.svg` | `@iconify-json/logos` 1.2.14, `apple` | Gil Barbara / SVG Logos | CC0-1.0 | Add explicit source dimensions and viewBox; apply currentColor to the supplied monochrome silhouette. |
| `email.svg` | `@iconify-json/solar` 1.2.12, `letter-linear` | 480 Design / Solar | CC-BY-4.0 | Add explicit source dimensions and viewBox; preserve currentColor strokes and geometry. |

SVG Logos source and license: [gilbarbara/logos](https://github.com/gilbarbara/logos), [CC0 notice](https://github.com/gilbarbara/logos/blob/master/LICENSE.txt).

Solar attribution: **Solar by 480 Design**, [original design collection](https://www.figma.com/community/file/1166831539721848736), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The SVG wrapper is adapted as described above; no affiliation or endorsement is implied.

Artwork is decorative beside a translated method name. Sources are validated by the existing icon generator before `AppIcon` consumes them. Run `pnpm icons:write` after changing sources or registry metadata, then `pnpm icons:check`.
