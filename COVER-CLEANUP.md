# Codex-assisted cover cleanup

Approval is a review step, not a file write. After approval, click **Save approved albums**.
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

Open Tag Maestro in Chrome or Edge at `http://127.0.0.1:5173` and use **Add Root Folder** (read/write access), then **Tools → Codex-assisted cover cleanup**.

1. Select up to 25 albums and export a ZIP. Each folder/edition has a distinct job ID. The ZIP contains originals, source fingerprints, a manifest and carefully scoped editing prompts.
2. Extract it into your Codex workspace and ask Codex to follow `CODEX-PROMPT.md` with the built-in image editor. This is a human-assisted workflow: Tag Maestro does not call Codex or an API automatically. No LaMa is used.
3. Keep `manifest.json` and `originals/` unchanged. Return a ZIP with edited images in `edited/`, retaining exact job-ID filenames. Partial batches are accepted. Or explicitly assign one image to the currently displayed album.
4. Review original/edited artwork. Check authentic lettering, logos and faces; AI can redraw details incorrectly. Approve each satisfactory cover.
5. Save approved albums. The app embeds a compact **500×500 JPEG** in every song in that album. Non-square imports are padded, not stretched/cropped. No text tags, filenames, loose images or unselected album folders are modified.

Imported edits and approvals are held in this browser's IndexedDB for resuming. Keep exported ZIPs as portable checkpoints; clearing browser storage removes local review state. Changed source file sizes/timestamps invalidate approval. Read-only/file-input imports cannot overwrite originals; reopen with the native folder picker in Chrome/Edge. Folder permissions may need to be renewed after restarting the browser.

Saving is sequential and each completed song is read back and verified. WAV audio and all non-artwork RIFF chunks/ID3 frames are checked byte-for-byte before writing. Unsupported/malformed/flagged WAV tags are refused rather than discarded. MP3/FLAC/M4A use TagLib's metadata writer with no audio encoding. The first real-library test covers WAV only. A disk/permission failure can leave an album partially applied: reload the source and review remaining work rather than blindly retrying.

This is not the independent API-backed version. Image editing happens in Codex, subject to the user's Codex usage limits. Tag Maestro never collects an OpenAI API key in this workflow.

## Verification

`node scripts/test-file-saving.mjs` exercises cover replacement and removal,
audio preservation, disk read-back verification, silently ignored writes and
write failures using synthetic PCM audio in a temporary folder only.

`node scripts/test-wav-artwork.mjs` tests the shared artwork-only WAV writer. `scripts/verify-cover-cleanup.mjs` is deliberately scoped to the two reviewed Tum Bin/Masti working folders for this initial test, not a general bulk command. The `.design-qa/cover-cleanup-test/verification.json` report records audio and metadata checks; `original-id3-*.bin` retains original artwork tags for the test. Do not rerun an overwrite test on unreviewed sources.
