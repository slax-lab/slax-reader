# Runtime icon registry fixtures

These assets are checked-in fixtures for the Web runtime icon registry. They exercise the same manifest, validation, hashing, generation, and renderer paths as product icons, while remaining small enough to avoid meaningful bundle cost.

- `mask.svg` contains only local monochrome geometry. The validator rejects active content and external references before the file can become a CSS mask.
- `brand.svg` uses a fixed, reviewed palette and contains only primitive SVG geometry. It verifies that fixed-color artwork stays outside the inline `v-html` renderer.
- `raster.png` is a 1×1 opaque PNG encoded as a complete binary image. It verifies byte-accurate hashing and the fixed-image renderer without remote or user-controlled input.

These fixtures are registry-owned build inputs, not article content and not Extension assets. They must stay under this directory so canonical path validation can enforce the Web asset boundary.
