# Tag Maestro desktop test build

## Current status

An offline Electron desktop bundle, Apple Silicon Mac app, DMG installer and app ZIP have been built locally. No development server, separate browser or Node installation is required by the packaged app. Windows x64 NSIS installer and portable EXE targets are configured, but have not been built or tested yet.

The user approved `unsafe-eval` for the bundled TagLib/Emscripten JavaScript bindings. The Mac 1.0.1 packaged integration test now passes metadata save/read-back, embedded artwork replacement/removal, audio playback/seek, verified deletion, scan-time duration, and restart persistence. Node remains disabled; renderer sandboxing, context isolation and blocked remote/network access remain enabled.

Local outputs:

- `dist-package/mac-arm64/Tag Maestro.app`
- `dist-package/Tag Maestro-1.0.1-mac-arm64.dmg`
- `dist-package/Tag Maestro-1.0.1-mac-arm64.zip`

The DMG checksum has been verified with `hdiutil verify`. These are unsigned local test builds; public distribution needs Apple signing/notarization and separate Windows signing. No installers have been published.

## Build and test

Use Node 24 and pnpm 11.25.0 on the build machine:

```sh
pnpm install --frozen-lockfile
pnpm desktop         # build and run locally, without a dev server
pnpm dist:mac        # Apple Silicon .app, .dmg and ZIP, on macOS
pnpm dist:win        # x64 installer and portable .exe, on Windows
pnpm test:desktop    # isolated synthetic metadata/audio/deletion/restart tests
```

`scripts/test-desktop.mjs` also accepts an absolute packaged executable path as its first argument. It creates an isolated temporary app profile and synthetic audio fixtures, never opens or alters the user's music library, and retains the fixture profile for diagnosis. Full native tests must pass before distributing installers.

The manual `Desktop test builds` GitHub workflow builds Mac and Windows targets, runs fixture tests, and uploads artifacts only after success. It is not automatically dispatched or published by local packaging.

## Local storage and safety

- Stable `tagmaestro://app` secure origin and persistent Electron session preserve preferences and library handles across restarts. Browser-app settings/libraries do not automatically transfer; select your source folders in the desktop app.
- Node is disabled in the renderer; context isolation and sandboxing are enabled. There is no filesystem IPC/preload bridge.
- Native Chromium file/folder pickers grant scoped handles. Restricted system-folder access, remote navigation, new windows, webviews and outbound network requests are blocked.
- Existing verified-save and exact-file deletion checks are reused. Single and bulk delete remain immediate, permanent operations as requested; they are not Trash operations.
- All UI, TagLib/WASM and artwork assets are packaged locally. Desktop and existing web build entry points remain separate.

Verified locally: renderer TypeScript/web build, app-origin/path-confinement tests, table preferences, cover-batch settings, embedded-cover/verified-save regression tests, scan-time length and front-cover preference, and the actual packaged Mac app's isolated metadata/artwork/playback/seek/deletion/restart tests. DMG integrity also passes. Tests do not modify user music. Interactive folder access and further format testing should be performed on disposable copies before editing originals. Windows native tests run in the build workflow.

## Library editing changes in 1.0.1

- Fast library scans read duration/sample rate/bitrate from container properties, without decoding the full song.
- The editor lazy-loads the selected song's embedded artwork. It prefers FrontCover, displays the complete image without cropping, and no longer injects a random image from a `covers/` subfolder.
- Bulk Edit's Target field picker includes Filename, Folder name, Title, Artist, Album, Album Artist, Composer, Genre, Year, Track, Discnumber, Tag, Comment and BPM. The target row does not shrink away inside the dialog. Folder name changes affect exported paths, not original folders on disk; they force an export rather than claiming a direct folder rename.
- Codex cover cleanup remains a dedicated toolbar button. Its duplicate Tools entry has been removed.
- Comment supports keep/blank/existing-value choices and multiline editing.

For an already-loaded web library, save unrelated pending edits first, then use Tools → Reload tags from files to refresh embedded covers and lengths. Folder images are no longer silently substituted for embedded artwork.
