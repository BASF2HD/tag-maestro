# Tag Maestro 1.1.0

Bulk album artwork updates, online singer credits and flexible filename-to-tag extraction are now available in standalone builds for Apple Silicon, Intel Mac and Windows.

- Find front covers in each album’s Covers folder, review them, and replace embedded front artwork across selected albums with verified saves.
- Double-click editor cover art to view the full-resolution image, with Fit and 100% views.
- Look up album and track metadata through Apple’s catalog, Spotify, Wikipedia, and supplied Apple Music, Spotify, JioSaavn and Deezer album links.
- Review fetched singers, album artist, composer, year and other available fields, including values protected by existing tags or source priority.
- Preview supplied-page singer credits and choose that page for Artist / singers while other fields retain their normal source priority.
- Match Tamil titles across English spelling differences, with manual song choices when Female/Male or other versions are ambiguous.
- Follow lookup progress, source responses and elapsed time while checking albums.
- Extract part of a filename into a tag using separators, numbers, numbered parts or character positions, with a live preview.
- Keep the current tag engine and artwork tools available when a local development build replaces generated assets.
- Choose whether names-only scans include subfolders, trim leftover rename whitespace and show clearer invalid-name messages.

## Downloads

- Apple Silicon Mac (arm64): DMG installer and app ZIP.
- Intel Mac (x64): DMG installer and app ZIP.
- Windows x64: Setup installer and Portable EXE.

No Node.js, separate browser or development server is needed. SHA256SUMS contains checksums for all six downloads. Each platform’s packaged app is tested on its native GitHub runner before publication.

These community builds are unsigned and not Apple-notarized, as in earlier releases. Metadata updates remain staged until Apply and Save originals; existing tags are protected unless replacement is enabled. Source credits and catalog dates vary by edition, so review the proposed changes before saving.

Back up originals before bulk edits. Tests use disposable synthetic files and isolated app profiles, never personal music.
