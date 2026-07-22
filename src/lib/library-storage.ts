const DATABASE_NAME = "tagmaestro-library";
const DATABASE_VERSION = 1;
const SOURCE_STORE = "sources";

type StoredLibrarySourceBase = {
  id: string;
  name: string;
  excludedPaths: string[];
  addedAt: number;
};

export type StoredLibrarySource =
  | (StoredLibrarySourceBase & {
      kind: "directory";
      handle: FileSystemDirectoryHandle;
    })
  | (StoredLibrarySourceBase & {
      kind: "files";
      handles: FileSystemFileHandle[];
    });

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SOURCE_STORE)) {
        db.createObjectStore(SOURCE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open library storage"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Library storage failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(SOURCE_STORE, mode);
    return await requestResult(action(transaction.objectStore(SOURCE_STORE)));
  } finally {
    db.close();
  }
}

export function listLibrarySources(): Promise<StoredLibrarySource[]> {
  return withStore("readonly", (store) => store.getAll());
}

export async function saveLibrarySource(source: StoredLibrarySource): Promise<void> {
  await withStore("readwrite", (store) => store.put(source));
}

export async function removeLibrarySource(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearLibrarySources(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

export async function excludeLibraryPaths(id: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const source = await withStore<StoredLibrarySource | undefined>("readonly", (store) =>
    store.get(id),
  );
  if (!source) return;

  const excludedPaths = new Set(source.excludedPaths);
  for (const path of paths) excludedPaths.add(path);
  await saveLibrarySource({ ...source, excludedPaths: [...excludedPaths] });
}
