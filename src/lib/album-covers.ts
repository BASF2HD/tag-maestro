import type { AlbumGroup } from "./album-groups";
import { dataUrlToCover, writeCoverToBlob, type Mp3File, type Mp3Tags } from "./mp3";
import { writeVerifiedFile } from "./verified-file-write";

export type CoverCandidate = { name: string; handle: FileSystemFileHandle };
export type CoverScan = { album: AlbumGroup; candidates: CoverCandidate[]; error?: string };
export type CoverReceipt = { row: Mp3File; file: File; cover: NonNullable<Mp3Tags["cover"]> };
type Directory = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
export function isFrontCover(name: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return (
    /\.(?:jpe?g|png|webp)$/i.test(name) &&
    !/(?:^|[ _.-])(?:back|rear)(?:[ _.-]|$)/i.test(base) &&
    /(?:^|[ _.-])(?:front|frontcover|coverfront)(?:[ _.-]|$)/i.test(base)
  );
}
export async function scanAlbumCover(album: AlbumGroup): Promise<CoverScan> {
  const candidates: CoverCandidate[] = [];
  try {
    const directory = album.files[0].sourceDirectoryHandle as Directory | undefined;
    if (!directory) throw new Error("Use Add Folder to give access to the album’s Covers folder.");
    const collect = async (dir: Directory, prefix: string) => {
      for await (const entry of dir.values()) {
        if (entry.kind === "file" && isFrontCover(entry.name))
          candidates.push({ name: prefix + entry.name, handle: entry as FileSystemFileHandle });
      }
    };
    for await (const entry of directory.values()) {
      if (entry.kind === "directory" && /^covers?$/i.test(entry.name))
        await collect(entry as Directory, `${entry.name}/`);
    }
    // Front images beside the music are also common. Prefer Covers/ when present.
    if (!candidates.length) await collect(directory, "");
    candidates.sort((a, b) => a.name.localeCompare(b.name));
    return {
      album,
      candidates,
      error: candidates.length ? undefined : "No front image found (Back images are ignored).",
    };
  } catch (error) {
    return { album, candidates, error: error instanceof Error ? error.message : String(error) };
  }
}
export async function loadFolderCover(
  candidate: CoverCandidate,
): Promise<NonNullable<Mp3Tags["cover"]>> {
  const image = await candidate.handle.getFile();
  if (!image.size || image.size > 32 * 1024 * 1024)
    throw new Error("Cover must be between 1 byte and 32 MB.");
  const bitmap = await createImageBitmap(image);
  bitmap.close();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Cannot read cover image"));
    reader.readAsDataURL(image);
  });
  const cover = dataUrlToCover(dataUrl);
  if (!cover) throw new Error("Unsupported cover image");
  return cover;
}
// One album/image and one audio file at a time, so a 500-album job does not load all audio into memory.
export async function replaceAlbumCovers(
  jobs: { scan: CoverScan; candidate: CoverCandidate }[],
  options: {
    cancelled(): boolean;
    progress(message: string): void;
    saved(receipt: CoverReceipt): void;
    failed(id: string, message: string): void;
    completed(id: string): void;
  },
) {
  let saved = 0,
    failed = 0;
  for (const { scan, candidate } of jobs) {
    if (options.cancelled()) break;
    let cover: NonNullable<Mp3Tags["cover"]>;
    try {
      cover = await loadFolderCover(candidate);
    } catch (error) {
      failed += scan.album.files.length;
      options.failed(scan.album.id, String(error));
      continue;
    }
    let albumFailed = false;
    for (const row of scan.album.files) {
      if (options.cancelled()) break;
      options.progress(`${saved + failed + 1}: ${scan.album.name} — ${row.file.name}`);
      try {
        if (row.coverEdited)
          throw new Error("Pending artwork edit: save or reload this track first.");
        const handle = row.sourceHandle as FileSystemFileHandle & {
          queryPermission(o: { mode: string }): Promise<string>;
          requestPermission(o: { mode: string }): Promise<string>;
        };
        if (!handle) throw new Error("Use Add Folder to enable saving originals.");
        if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted")
          throw new Error("Write access missing. Reopen the library with Add Folder.");
        const live = await handle.getFile();
        if (live.size !== row.file.size || live.lastModified !== row.file.lastModified)
          throw new Error("File changed on disk. Reload tags before retrying.");
        const blob = await writeCoverToBlob(live, cover);
        if (options.cancelled()) break;
        const latest = await handle.getFile();
        if (latest.size !== live.size || latest.lastModified !== live.lastModified)
          throw new Error("File changed while preparing artwork.");
        const file = await writeVerifiedFile(handle, blob);
        options.saved({ row, file, cover });
        saved++;
      } catch (error) {
        failed++;
        albumFailed = true;
        options.failed(
          scan.album.id,
          `${row.file.name}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (!albumFailed && !options.cancelled()) options.completed(scan.album.id);
  }
  return { saved, failed };
}
