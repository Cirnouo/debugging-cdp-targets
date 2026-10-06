# Claude directory artwork

The generated payload includes `icon.png`, copied byte for byte from the
approved shared assets. The top-level manifest `icon` field supplies directory
listing artwork. Claude Code ignores this field when loading the Plugin.

Only this README is a host packaging input here. The build supplies the PNG
from `packaging/shared/assets`; source artwork and generation provenance remain
repository inputs and are not delivered.
