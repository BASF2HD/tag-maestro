import type { Mp3File } from "./mp3";

export type AlbumGroup = { id: string; name: string; query: string; files: Mp3File[] };
export function albumGroups(files: Mp3File[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();
  for (const file of files) {
    // Paths, rather than album tags, keep different editions and roots separate.
    const id = JSON.stringify([
      file.librarySourceId || "",
      file.folderPath || "",
      file.folderPath ? "" : file.tags.album || file.id,
    ]);
    let group = groups.get(id);
    if (!group) {
      const name = file.tags.album.trim() || file.folderName || file.file.name;
      const query = name
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\(\d{4}\)/g, "")
        .trim();
      group = { id, name, query, files: [] };
      groups.set(id, group);
    }
    group.files.push(file);
  }
  return [...groups.values()];
}
