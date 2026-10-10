# Large libraries and archive names

Use **Folder & archive names → Choose library folder** in the desktop app when only names need changing. This native mode enumerates directories and ZIP, RAR, 7z, tar and common compressed tar archives, without opening audio files, extracting archives, or loading cover images. Filter by folders or archives, enter literal Find / Replace text, check the matching items (the header checkbox includes every page), review the proposed names, then **Save original names**. Each original extension is retained, including compound `.tar.gz` suffixes. Archives are renamed as opaque files; tags inside them are not edited. Other excluded file types are reported instead of silently showing an unexplained empty list.

The native picker grants access only to the chosen library. Saving accepts listed item IDs rather than arbitrary paths, refuses symlinks and invalid names, asks before resolving name conflicts, and uses same-parent filesystem renames instead of copy/export. Parent folders and their descendants must be renamed in separate saves. Existing pending song edits must be saved or discarded first. A successful rename clears the current song table / remembered library so stale file handles cannot be used. Reload songs afterwards if tags also need editing.

Normal **Add Folder** loading now filters audio names before requesting file snapshots, shows batches as directories are discovered, uses four concurrent readers, reads metadata via random-access Blob slices rather than transferring whole songs, and defers embedded artwork. Tags and technical metadata are cached by library/path plus size and modification time; unchanged files reuse that cache on later loads. Unsupported or damaged files may still use the older full-file fallback. Exact duration can be unavailable without a complete scan for some formats. The full metadata/artwork reader remains available when a track is selected/reloaded. Metadata writes still require reading/writing the relevant complete file to preserve its audio and other tags.

“Scanning” is not audio conversion: directory enumeration discovers file names and nested albums. A NAS still has to answer these directory and file-info requests. The app cannot know about new/renamed files without listing them. Network latency, disk sleep and the number of files affect actual timings. No universal 5,000-album NAS speed is promised. The local fixture benchmark and byte-range regression tests are not NAS benchmarks.

Browser folder access can use the lighter metadata reads/cache as well, but native in-place directory/archive renaming is desktop-only. ZIP files intentionally are not treated as playable songs or passed to the tag writer.

### Conflicting names

Saving shows a live phase progress bar (checking names, validation, renaming, or
error recovery), the current filename, elapsed seconds, and actual renamed/skipped
counts. Checks do not count as file changes. A slow NAS call can leave the phase
counter unchanged; the elapsed clock continues and a waiting-for-drive notice appears.
The completed save summary stays visible until the next save or the dialog is closed.
The conflict prompt is hidden while the chosen action is executing.

If a proposed destination already exists, saving pauses before any rename and asks
whether to **Skip conflicting names**, **Overwrite existing items**, or **Cancel**.
Skip preserves the existing items and saves the other names. Overwrite keeps the
replaced item in a hidden `.tag-maestro-replaced-…` recovery path in the same parent
folder, then renames the incoming item into place. No archive extraction or copying
is involved. Folder replacement replaces the whole folder; it does not merge contents.
The completion report lists recovery paths. To restore, move the replacement aside,
then rename the backup to its original name using Finder/Explorer (show hidden files).
Backups are excluded from subsequent names-only listings and are never automatically deleted.

Unsafe conflicts (duplicate proposed targets, destinations containing another selected
item, case-only aliases, symbolic links or mismatched file/folder types) are always
skipped rather than overwritten. If the source or destination changes while the prompt
is open, saving refuses that stale choice; save again to review current conflicts.
