# Tag Maestro desktop builds

[Downloads](https://github.com/BASF2HD/tag-maestro/releases) · [Website](https://BASF2HD.github.io/tag-maestro/)

## Build and test

Use Node 24 and pnpm 11.25.0 on the target OS:

```sh
pnpm install --frozen-lockfile
pnpm desktop
pnpm dist:mac
pnpm dist:win
node scripts/test-release.mjs
node scripts/test-desktop.mjs "path/to/packaged/executable"
```

Apple Silicon builds contain an .app, DMG and app ZIP; Windows x64 builds contain Setup and Portable EXEs. No Node.js, separate browser or server is needed to run them.

The release-tag workflow builds on native macOS and Windows runners, tests actual packaged executables with isolated profiles and synthetic files, then publishes assets and SHA256SUMS only if both jobs pass. A manual retry requires an existing version tag. Builds are unsigned and not Apple-notarized; signing credentials must be configured separately before claiming trusted/signed distribution.

## Local storage and permissions

A stable `tagmaestro://app` secure origin and persistent Electron session retain preferences and library handles across restarts. Browser settings and handles do not automatically transfer; choose folders in the desktop app.

Node is disabled in the renderer. Context isolation, sandboxing, blocked remote navigation and outbound-network restrictions remain enabled. The bundled TagLib/Emscripten engine uses dynamic JavaScript evaluation, explicitly approved by the user.

Chromium file pickers grant scoped handles for tags/artwork. The preload exposes narrow native capabilities for original-folder and folder/archive-name renames: the native chooser grants the library, opaque IDs scope the operation, and source identity, parent paths and conflict destinations are revalidated before changes. Unknown/expired capabilities are rejected; there is no general arbitrary-path filesystem API.

## Library changes

- [Folder name edits](desktop/FOLDER-RENAMING.md) save originals in place in the desktop app, without exporting song copies.
- Names-only mode lists folders plus ZIP/RAR/7z/tar archives without extraction or reading songs. Skip, cancel, or overwrite with a hidden sibling backup resolves conflicts. Progress shows phases and actual changed/skipped counts.
- [NAS metadata scanning](desktop/NAS-LIBRARIES.md) uses range reads, bounded concurrency, lazy embedded artwork and cached metadata. Real speed still depends on NAS latency and connection.
- The editor prefers embedded FrontCover over disc artwork; bulk find/replace has a target-field selector; comment supports keep/clear/value choices.
- Cover cleanup is a separate reviewed Codex batch workflow, not an automatic image API.
- Verified tag/artwork saves read back disk bytes. Single/bulk song deletion is immediate and permanent, not Trash.

Tests never touch user music. Native fixtures cover metadata/artwork save/remove, playback/seek, deletion safety, scopes, scan-time duration, progress/conflicts and restart persistence. Back up originals and test unfamiliar formats on copies before bulk editing.
