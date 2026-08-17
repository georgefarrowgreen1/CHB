# `build/`

`icon.png` is the site's own `icon-512.png`, copied rather than linked so the app
bundle does not depend on the website's folder being present. electron-builder
converts it to an `.icns` at build time.

512×512 is the smallest size electron-builder accepts. If the app ever wants a
crisper icon in the Dock on a Retina display, replace this with a 1024×1024 of
the same mark — nothing else needs changing.
