# Rename original album folders

Use the desktop app and **Add Folder** to load the parent music library containing your albums. Choose **Folder name** in Bulk Edit / Find and replace, apply the changes, then click **Save originals**.

On the first folder rename per loaded library/session, choose that same parent library in the native permission dialog. Tag Maestro validates the folder names and a small fingerprint of each album's loaded song before writing anything. This native capability is scoped to the selected library and is not a general filesystem API.

Folder-only edits use a same-parent directory rename: no song copies, metadata rewrites or audio encoding. Loose cover files and other album contents move with their directory. All loaded songs in a renamed folder have their paths/handles refreshed, including unselected tracks and nested tracks. Existing destination folders, symbolic links, invalid names and simultaneous parent/child renames are rejected. Case-only directory changes are currently rejected when the destination already exists; make such changes in two separate saves with a temporary distinct name.

The browser app cannot rename existing directories. It refuses to export copies for folder-name edits and tells you to use the desktop app. Individual tag editing and supported original-file saving remain available in the browser.

Tests only use synthetic temporary music and folders, never the user's albums.
