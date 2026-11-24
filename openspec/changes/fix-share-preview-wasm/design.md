## Context

The public article route emits a signed `/_og/d/` URL for a title card when there is no existing image. On Cloudflare Pages, the Satori binding loads a generated Yoga module which awaits a dynamic WASM import at module scope. workerd fails during module evaluation. An isolated Pages reproduction rendered a PNG after changing the Yoga module to a static WASM import.

## Goals / Non-Goals

Restore the existing PNG generation path and verify it through the public article route in a built Worker. The template, article metadata policy, and project runtime configuration are outside this change.

## Decisions

- Scope the build transform to the Satori Yoga module on the Pages preset. Let the existing WASM tooling emit the compiled asset and resolve its reference.
- Add a synthetic article to the existing workerd smoke harness. Stub the content service and serve the compiled build's fonts through ASSETS. Read the image URL from the rendered HTML and request it in the same Worker.
- Run the existing workerd smoke check after the Web release build and before publication. Reuse the release artifact and require no additional credentials.

## Risks / Trade-offs

The transform matches the generated binding from the pinned WASM tooling. The built Worker smoke check catches a recurrence if a dependency changes how it emits the binding.
