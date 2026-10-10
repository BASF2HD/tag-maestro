import type { Mp3File, Mp3Tags, FileMeta } from "./mp3";
type Record = { key: string[]; size: number; modified: number; tags: Mp3Tags; meta: FileMeta };
const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("tagmaestro-metadata-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("metadata", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
// Optional acceleration, never a requirement for loading files or saving originals.
export async function readMetadataCache(
  sourceId: string | undefined,
  files: { path: string; file: File }[],
) {
  const result = new Map<string, Record>();
  if (!sourceId || typeof indexedDB === "undefined") return result;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const transaction = db.transaction("metadata", "readonly"),
      store = transaction.objectStore("metadata");
    await Promise.all(
      files.map(
        (entry) =>
          new Promise<void>((resolve) => {
            const request = store.get([sourceId, entry.path]);
            request.onsuccess = () => {
              const record = request.result as Record | undefined;
              if (
                record &&
                record.size === entry.file.size &&
                record.modified === entry.file.lastModified
              )
                result.set(entry.path, record);
              resolve();
            };
            request.onerror = () => resolve();
          }),
      ),
    );
  } catch {
    /* Storage unavailable: read the file as usual. */
  } finally {
    db?.close();
  }
  return result;
}
export async function saveMetadataCache(sourceId: string | undefined, files: Mp3File[]) {
  if (!sourceId || typeof indexedDB === "undefined") return;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    const transaction = db.transaction("metadata", "readwrite");
    const complete = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const store = transaction.objectStore("metadata");
    for (const row of files) {
      const { cover: _cover, ...text } = row.tags;
      store.put({
        key: [sourceId, row.libraryRelativePath!],
        size: row.file.size,
        modified: row.file.lastModified,
        tags: text,
        meta: row.meta,
      });
    }
    await complete;
  } catch {
    /* Quota/privacy failures must not interrupt a NAS import. */
  } finally {
    db?.close();
  }
}
