# Codex listing artwork

The generated payload includes `icon.png` and `icon-dark.png`, copied byte for
byte from the approved shared assets. The manifest uses the opaque universal
`icon.png` for both `logo` and `composerIcon`, so small icons remain readable on
light and dark surfaces. It retains `icon-dark.png` for `logoDark` and
`composerIconDark`; Codex Desktop uses `logoDark` on supported large icon surfaces
but currently ignores `composerIconDark`.

Only this README is a host packaging input here. The build supplies the PNGs
from `packaging/shared/assets`; source artwork and generation provenance remain
repository inputs and are not delivered.
