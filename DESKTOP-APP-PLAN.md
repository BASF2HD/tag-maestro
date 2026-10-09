# Tag Maestro standalone desktop plan

Status: design proposal only. This update does not produce or claim tested `.app`, `.dmg` or `.exe` installers.

## Recommended approach

Use Electron with the existing React interface and TagLib/WASM metadata engine. Keep the current browser app working alongside a separate desktop entry point; do not replace its TanStack Start routing or SSR entry. The desktop renderer should bundle locally, require neither a dev server nor an internet connection, and load from a stable, registered secure app origin such as `tagmaestro://app`.

Do not wrap a randomly chosen localhost port: changing the origin would lose access to origin-scoped preferences and IndexedDB. Use a persistent Electron session in the app's user-data directory, retaining its identity across app upgrades. Existing browser libraries/settings will not silently transfer to the desktop app; provide a deliberate settings export/import migration if needed.

## File access and safety

Start with a narrowly scoped native file-access adapter through an isolated preload bridge. Open Folder returns opaque capabilities for user-chosen directories, not unrestricted filesystem access. Renderer requests must be checked against those capabilities in the main process, including symlink/path traversal prevention, original-file identity and size/modification-time checks, verified writes and exact single-file deletion. Reuse the existing verified-write, format and artwork-validation logic.

Never expose Node.js to the renderer, accept arbitrary paths from IPC, disable context isolation, or permit remote navigation in the app window. Keep `nodeIntegration: false`, `contextIsolation: true` and the renderer sandbox enabled. Unrelated browser permissions should remain denied. The existing browser filesystem workflow remains available in the web build.

Current immediate permanent-delete behavior must be explicit in the desktop UI as well; do not silently replace it with a different bulk-deletion policy. Test only disposable fixtures during development.

## Build outputs

- macOS Apple Silicon: `Tag Maestro.app` inside a `.dmg`, plus a zipped app for testing.
- macOS Intel: a separate x64 package, or a universal package after testing both architectures.
- Windows: NSIS `.exe` installer for x64, with optional ARM64 and portable `.exe` outputs after validation.
- Build Mac outputs on a macOS runner and Windows outputs on a Windows runner. Bundle the renderer, WASM and required assets; no separate Node.js or browser installation should be required.

Use electron-builder for packaging, with a stable app ID/product name and architecture-qualified artifact names. Add explicit manual/release GitHub Actions builds, artifact retention and fixture-based smoke tests. Do not publish installers until native read, save, cover import, playback/seek, bulk deletion, next-song reveal and restart persistence all pass.

Unsigned builds are suitable for initial local testing but can trigger OS warnings. Trusted public Mac distribution needs Apple signing/notarization; Windows signing requires its own signing setup. Do not promise warning-free installation without these credentials and verification.

## Delivery sequence

1. Desktop renderer and secure app origin; restart-persistent settings and library database.
2. Native folder adapter and verified writes/deletion, tested against synthetic music fixtures.
3. Mac `.app` and `.dmg` local build, install/relaunch and audio-format checks.
4. Windows `.exe` runner build and native file/playback tests.
5. Signing, notarization and a release workflow after the test builds are accepted.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [persistent Electron sessions](https://www.electronjs.org/docs/latest/api/session), [electron-builder packaging targets](https://www.electron.build/docs/), [DMG](https://www.electron.build/v26/docs/dmg/), [NSIS](https://www.electron.build/docs/nsis/).
