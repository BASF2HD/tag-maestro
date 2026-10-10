# Tag Maestro 1.0.6

Manage music tags, embedded cover artwork and library names locally.

- Fast, paginated folder/archive-name mode for ZIP, RAR, 7z and tar archives: no extraction or audio-tag reads.
- Rename originals in place; conflict choices include skip, cancel and overwrite with recoverable hidden sibling backups.
- Live rename progress, changed/skipped counts, current item and clear completion feedback.
- NAS-friendly partial metadata reads, concurrent scanning, lazy artwork and metadata caching.
- Verified tag/artwork saves, playback/seek controls, immediate single/bulk file deletion and persistent table settings.
- Codex cover-cleanup batch export/import, before/after review and individual or bulk approval.

## Downloads

Apple Silicon: DMG installer or ZIP containing the standalone .app.
Windows x64: Setup installer or Portable EXE. No Node.js or separate browser required.

**Unsigned community builds:** Apple notarization and Windows code signing are not configured. Gatekeeper/SmartScreen may warn; verify the repository, version and SHA256SUMS before opening. Do not bypass protections for an untrusted download.

Metadata/artwork/deletion and restart-persistence checks run on the actual packaged app on native Mac and Windows runners before publication. Tests use disposable synthetic files, not personal music.

Back up your music. Song deletion is immediate and permanent. Overwritten name conflicts preserve the previous destination as a hidden sibling backup, not a merge.
