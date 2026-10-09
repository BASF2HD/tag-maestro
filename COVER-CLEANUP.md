# Codex-assisted cover cleanup

Approval is a review step, not a file write. After approval, click **Save approved albums**.
The **Approve all imported artwork** checkbox approves or revokes approval for
every matching, unsaved imported edit across all pages (not just the current filter).
It excludes missing edits, changed source fingerprints and already-saved artwork.
A mixed checkbox means only some eligible covers are approved. Approving all also
selects those albums for the separate Save action; you can still approve individually.
Only a verified direct write is labelled saved. The regular editor's read-only
download/ZIP export leaves originals unchanged and edits pending. To overwrite
original music, open the source with **Add Folder / Add Root Folder** in Chrome or
Edge and grant write access. **Reload tags from files** now reopens disk files,
including embedded artwork, instead of retaining the displayed cover.

ZIP import loads unchanged albums even when other albums have changed since
export. Skipped albums are listed above the comparison view; export those albums
again rather than editing the manifest. Re-adding the identical source folder is
supported only when folder paths, complete track fingerprints and artwork hashes
match uniquely. Edited images remain unapproved until you explicitly approve them.

You can re-import the same edited ZIP after saving artwork. The importer recognizes
a previous verified Tag Maestro save using the full current file fingerprint,
unchanged track paths, original batch provenance and current embedded artwork hash.
Re-import resets approval/saved flags and compares the imported edit against the
current disk artwork. Repeated imports before saving are supported too. Unrelated
file changes, missing tracks and ambiguous editions still require a fresh export
or explicit image assignment. Re-import never writes songs automatically.

Open Tag Maestro in Chrome or Edge at `http://127.0.0.1:5173` and use **Add Root Folder** (read/write access), then **Tools → Codex-assisted cover cleanup**.

1. Choose **Albums per batch** (25, 50, 100, 250 or 500), then **Select this page** and export a ZIP. The remembered setting controls page size and export selection limit. Default: 25. ZIPs are limited to 512 MB compressed/uncompressed; individual covers remain limited to 16 MB. Use smaller batches for large original scans. Each folder/edition has a distinct job ID. The ZIP contains originals, source fingerprints, a manifest and carefully scoped editing prompts.
2. Extract it into your Codex workspace and ask Codex to follow `CODEX-PROMPT.md` with the built-in image editor. This is a human-assisted workflow: Tag Maestro does not call Codex or an API automatically. No LaMa is used.
3. Keep `manifest.json` and `originals/` unchanged. Return a ZIP with edited images in `edited/`, retaining exact job-ID filenames. Partial batches are accepted. Or explicitly assign one image to the currently displayed album.
4. Review original/edited artwork. Check authentic lettering, logos and faces; AI can redraw details incorrectly. Approve each satisfactory cover.
5. Save approved albums. The app embeds a compact **500×500 JPEG** in every song in that album. Non-square imports are padded, not stretched/cropped. No text tags, filenames, loose images or unselected album folders are modified.

Imported edits and approvals are held in this browser's IndexedDB for resuming. Keep exported ZIPs as portable checkpoints; clearing browser storage removes local review state. Changed source file sizes/timestamps invalidate approval. Read-only/file-input imports cannot overwrite originals; reopen with the native folder picker in Chrome/Edge. Folder permissions may need to be renewed after restarting the browser.

Saving is sequential and each completed song is read back and verified. WAV audio and all non-artwork RIFF chunks/ID3 frames are checked byte-for-byte before writing. Unsupported/malformed/flagged WAV tags are refused rather than discarded. MP3/FLAC/M4A use TagLib's metadata writer with no audio encoding. The first real-library test covers WAV only. A disk/permission failure can leave an album partially applied: reload the source and review remaining work rather than blindly retrying.

This is not the independent API-backed version. Image editing happens in Codex, subject to the user's Codex usage limits. Tag Maestro never collects an OpenAI API key in this workflow.

## Verification

Saving keeps the current original/edited previews visible, preloads new previews,
uses a fixed-height progress area and applies completed library changes in one update
(including verified partial saves if a later write fails).
`node scripts/test-cover-batch-settings.mjs` checks batch-size persistence and fallbacks.
The synthetic browser regression at `scripts/test-cover-reimport.html` also covers
26-album export/import and observes preview continuity and library-update count during saving.

`node scripts/test-file-saving.mjs` exercises cover replacement and removal,
audio preservation, disk read-back verification, silently ignored writes and
write failures using synthetic PCM audio in a temporary folder only.

`node scripts/test-wav-artwork.mjs` tests the shared artwork-only WAV writer. `scripts/verify-cover-cleanup.mjs` is deliberately scoped to the two reviewed Tum Bin/Masti working folders for this initial test, not a general bulk command. The `.design-qa/cover-cleanup-test/verification.json` report records audio and metadata checks; `original-id3-*.bin` retains original artwork tags for the test. Do not rerun an overwrite test on unreviewed sources.
