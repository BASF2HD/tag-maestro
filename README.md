# Tag Maestro

A local music tag, embedded-cover and library-name editor for Mac and Windows.

[Download releases](https://github.com/BASF2HD/tag-maestro/releases) · [Website](https://BASF2HD.github.io/tag-maestro/)

Standalone Apple Silicon DMG/app ZIP and Windows x64 Setup/Portable EXE packages need no Node.js or separate browser. Builds are unsigned and not Apple-notarized: verify source, version and release SHA256SUMS before opening.

## What it does

- Edit tags and comments with bulk find/replace; preview songs with play/pause, seek, previous/next.
- Review imported Codex cover edits and approve individual or all imported artwork; verify embedded artwork/tag writes by reading files back.
- Fast folder/archive names mode for ZIP, RAR, 7z and tar: no extraction, audio reads or copying.
- Rename originals in place, with skip/overwrite/cancel conflict handling and recoverable hidden sibling backups for overwritten destinations.
- NAS-friendly range reads, lazy cover loading, cached metadata and streamed scan progress.
- Remember table column order, sizes, visibility and sorting.

Back up originals. Song deletion is immediate and permanent, including bulk deletion. Folder/archive renaming requires the desktop app; browser APIs cannot rename original directories. Supported tags/playback vary by format: raw AAC/ADTS tag writes are refused rather than silently claimed successful.

## Development and native packaging

Node 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm desktop
pnpm dist:mac
pnpm dist:win
node scripts/test-release.mjs
node scripts/test-desktop.mjs "path/to/packaged/executable"
```

Build Mac on macOS arm64 and Windows on Windows x64. Release tags must match package.json. GitHub Actions tests both actual packaged executables with temporary synthetic media and isolated profiles before publishing installers/checksums. The separate Pages workflow publishes site/, not user files or a running app.

[Desktop security/build notes](DESKTOP-APP.md) · [Original folder renaming](desktop/FOLDER-RENAMING.md) · [NAS libraries](desktop/NAS-LIBRARIES.md)
