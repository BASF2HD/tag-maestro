import type { Mp3File } from "./mp3";

type WritableDirectory = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

/** Continue after individual failures; only verified deletions are reported as deleted. */
export async function deleteSongBatch(
  songs: Mp3File[],
  progress: (song: Mp3File, index: number) => void = () => {},
  remove: (song: Mp3File) => Promise<void> = deleteSongFile,
) {
  const deleted: string[] = [];
  const failed: { song: Mp3File; message: string }[] = [];
  for (const [index, song] of songs.entries()) {
    progress(song, index);
    try {
      await remove(song);
      deleted.push(song.id);
    } catch (error) {
      failed.push({ song, message: error instanceof Error ? error.message : "Deletion failed" });
    }
  }
  return { deleted, failed };
}

/** Never restart an unrelated preview, wrap around, or play a deleted song. */
export function nextAfterDeletion<T extends { id: string }>(
  tracks: T[],
  activeId: string | null,
  deleted: Set<string>,
) {
  if (!activeId || !deleted.has(activeId)) return undefined;
  const index = tracks.findIndex((track) => track.id === activeId);
  return index < 0 ? undefined : tracks.slice(index + 1).find((track) => !deleted.has(track.id));
}

/** Delete exactly one verified file, never a directory. OS permission is still required. */
export async function deleteSongFile(song: Mp3File): Promise<void> {
  const directory = song.sourceDirectoryHandle as WritableDirectory | undefined;
  const source = song.sourceHandle;
  if (!directory || !source || typeof directory.removeEntry !== "function") {
    throw new Error(
      "Load the album with Open Folder (Chrome or Edge) to delete original files. File-only uploads do not grant folder deletion access.",
    );
  }
  const name = source.name;
  if (!name || name === "." || name === ".." || /[/\\]/.test(name) || name !== song.file.name) {
    throw new Error("Source filename changed. Reload the folder before deleting.");
  }
  const options = { mode: "readwrite" as const };
  let permission = directory.queryPermission ? await directory.queryPermission(options) : "granted";
  if (permission !== "granted" && directory.requestPermission) {
    permission = await directory.requestPermission(options);
  }
  if (permission !== "granted")
    throw new Error("Folder write permission was not granted. Nothing was deleted.");
  const current = await directory.getFileHandle(name, { create: false });
  if (typeof source.isSameEntry !== "function" || !(await source.isSameEntry(current))) {
    throw new Error("Source file identity changed. Reload the folder before deleting.");
  }
  const disk = await current.getFile();
  if (disk.size !== song.file.size || disk.lastModified !== song.file.lastModified) {
    throw new Error("This file changed on disk since it was loaded. Reload it before deleting.");
  }
  await directory.removeEntry(name, { recursive: false });
  try {
    await directory.getFileHandle(name, { create: false });
  } catch (error) {
    if ((error as { name?: string })?.name === "NotFoundError") return;
    throw new Error("Deletion could not be verified. Reload the folder to check its state.");
  }
  throw new Error("The file is still present. Deletion was not completed.");
}
