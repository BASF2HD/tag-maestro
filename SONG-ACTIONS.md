# Song preview and disk deletion

The table's Actions column offers Play/Pause, a quick-seek slider and Delete for each song. Drag an inactive song's seek slider to start previewing at that point. Seeking an active paused song preserves its paused state. Actions do not change the row selection or enter cell editing. A single shared audio element streams the original file; previews do not encode, upload or change audio. Switching songs stops the previous preview, and removing the active row stops playback.

The bottom status area has Previous, Play/Pause, Next, Delete, current song, elapsed time, a full seek slider and duration. Previous/Next follow the current filtered and sorted table order, including other pages, and stop at its first/last song. Filtering out a playing song does not stop it; its footer still works, but navigation is disabled until it is in the current list again. Footer deletion always targets the previewed file and uses the same source-file safety checks as row deletion.

Clock updates only refresh the bottom player and the active row's seek slider, not every table row. The footer reserves a fixed-height playback strip to avoid layout movement while loading or seeking.

Starting/resuming playback or changing songs from the bottom player reveals the song's table page and scrolls vertically only when needed, keeping it below the sticky header. The current preview row is highlighted independently of selection. If a search hides the current song, resuming it from the footer clears that search so the row can be shown. Pause and ordinary playback ticks do not force the table to scroll, so you can still browse other rows.

## Deleting an original

Open the album using **Add Folder / Add Root Folder** in Chrome or Edge so Tag Maestro has a handle to the containing directory. Files added through a plain file upload cannot grant directory deletion access.

Delete acts immediately without an app confirmation. It permanently deletes that one file, not just the table row, and discards its unsaved edits. Browser filesystem APIs do not move it to the operating system's Trash; Tag Maestro cannot undo it. The browser may still prompt for required folder-write permission if it has not already been granted; the app cannot bypass that permission. Existing Remove menu actions still only remove rows from the loaded library, not files on disk.

Deletion checks folder write permission, verifies the exact source handle and the loaded file's size/modification time, and uses non-recursive removal. If the file changed externally, reload it first. The row is removed only after verifying the original no longer exists. Permission errors and unsuccessful deletes retain the row. Album folders, artwork files and neighbouring songs are not deleted.

**Delete selected** is the trash icon with a selection count, immediately beside the single-song Delete icon and before the song information in the playback bar. It immediately deletes all selected original song files across pages and filters. Deletions run sequentially; individual failures remain loaded and selected, while successfully deleted rows are removed together to limit flickering. A summary reports successes and failures. There is no app confirmation or undo; browser-required folder-write permissions still apply.

Deleting the active preview, singly or in bulk, automatically starts the next remaining song after it in the current sorted/filtered order, skips successfully deleted songs and reveals the new row. If the active song is hidden by a search, the loaded-library order is used instead. Deleting unrelated songs does not interrupt playback. Failed deletion of the active song does not advance playback. At the end of the list (or after deleting all remaining songs), playback stops; it does not wrap around.

## Formats and limitations

Recognised imports: MP3; M4A/M4B/MP4 (AAC or ALAC); FLAC; WAV/WAVE; AAC/ADTS; Ogg/OGA; Opus; AIFF/AIF/AIFC; WMA; APE; WavPack; MPC/MPP/MP+; TTA; Speex/SPX.

Metadata uses the existing format-native TagLib writer. Raw AAC/ADTS is preview-only: its tag writer is not supported. AAC inside M4A supports tag editing. Unknown/archive formats such as ARC are not claimed to be music formats. Damaged or unrecognised containers can still fail validation.

Import/tag support does not mean every codec can play in every browser. Unsupported previews show a clear error and leave original audio unchanged. No decoder packages or external services are downloaded. Browser tests confirm WAV, MP3, FLAC, M4A, raw AAC, Ogg and Opus playback; AIFF and WMA were unsupported by the test browser. Synthetic metadata-write/readback checks pass for WAV, MP3, FLAC, M4A, Ogg, Opus, AIFF, WMA, WavPack and TTA.

## Regression checks

- `node scripts/test-song-actions.mjs`: shared-player state, rapid switching/cancellation, codec failure, permissions, source identity/staleness and verified single-file deletion. Uses generated temporary files only.
- `node scripts/test-file-saving.mjs`: existing artwork-save and unchanged-audio regression.
- `scripts/test-song-actions.html`: isolated actual-table browser harness using synthetic audio under `/private/tmp/tagmaestro-preview-fixtures`. Launch with `vite --config scripts/test-song-actions.config.ts`; it does not read real library files. Its Delete action only records a callback; actual disk deletion is checked by the Node regression.
