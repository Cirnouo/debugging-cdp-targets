# Shared visual assets

This directory is the only maintained source of the project's visual assets.
The selected icon, **独界 (dujie)**, uses two separate stepped faces and a clear
channel between them. Its shape was created with the built-in image generator;
user-authorized raster processing removes texture and stray edge pixels without
redrawing the mark.

- `icon-light.png`: transparent 1024 × 1024 icon for light backgrounds.
- `icon-dark.png`: transparent 1024 × 1024 icon for dark backgrounds. It shares
    exactly the same alpha channel as the light icon.
- `icon.png`: opaque 1024 × 1024 fallback with a light background for surfaces
    that accept only one icon.
- `icon-source.png`: preserved 1254 × 1254 generated raster used for cleanup.
- `generation.json`: refinement prompts, source hash, colors, dimensions and
    processing parameters. Image generation is not reproducible byte for byte.
- `README.md`: asset inventory and maintenance guidance.

Use the transparent variants in GitHub theme-aware images and Codex icon fields.
Use the opaque fallback for the Claude directory listing. Only the selected
delivery icons belong in generated host payloads; the source raster and this
generation record remain repository assets.

Preserve both faces, their separation and their relative proportions when
updating an icon. Derive theme colors from the same raster masks. Check the
icons on light and dark backgrounds at 16, 24, 32 and 64 pixels; theme variants
must remain the same shape. Preview contact sheets are not packaging inputs.
