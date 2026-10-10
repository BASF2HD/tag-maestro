import type { Mp3File } from './mp3';
import { listLibrarySources, saveLibrarySource } from './library-storage';
type Plan = { relative: string; name: string; anchor: { name: string; size: number; modified: number; digest: string } };
type Receipt = { relative: string; name: string };
declare global {
  interface Window {
    tagMaestroDesktop?: {
      chooseRenameRoot(name: string): Promise<{ token: string; name: string } | null>;
      prepareFolderRenames(token: string, plans: Plan[]): Promise<string>;
      commitFolderRenames(transaction: string): Promise<{ renamed: Receipt[]; error?: string }>;
      chooseNameLibrary(): Promise<{ id: string; name: string } | null>;
      pollNameLibrary(id: string, offset: number): Promise<{ entries: NameEntry[]; total: number; visited: number; done: boolean; stopped: boolean; warnings: string[]; warningCount: number; ignored: { extension: string; count: number }[] }>;
      stopNameLibrary(id: string): Promise<void>;
      pollNameSaveProgress(id: string): Promise<NameSaveProgress | null>;
      releaseNameLibrary(id: string): Promise<void>;
      renameLibraryNames(id: string, plans: { id: string; name: string }[], resolution?: { token: string; policy: 'skip' | 'overwrite' }): Promise<NameRenameResult>;
    };
  }
}
const rootTokens = new Map<string, string>();
export type NameEntry = { id: string; relative: string; name: string; kind: 'folder' | 'archive' };
export type NameConflict = { id: string; relative: string; name: string; canOverwrite: boolean; reason: string };
export type NameSaveProgress = {
  stage: 'preparing' | 'awaiting-choice' | 'validating' | 'renaming' | 'rolling-back' | 'complete' | 'failed';
  total: number; stageTotal: number; processed: number; renamed: number; skipped: number;
  conflicts: number; backups: number; current: string; startedAt: number; updatedAt: number; error?: string;
};
export type NameRenameResult = {
  renamed: { id: string; relative: string; name: string }[];
  error?: string;
  conflictToken?: string;
  conflicts?: NameConflict[];
  skipped?: { id: string; relative: string; name: string; reason: string }[];
  removedIds?: string[];
  backups?: { original: string; backup: string }[];
};
export function canRenameOriginalFolder(file: Mp3File): boolean {
  return Boolean(window.tagMaestroDesktop && file.librarySourceId && file.sourceFolderParentHandle);
}
export function hasTagEdits(file: Mp3File): boolean {
  return Boolean(file.coverEdited || Object.keys(file.tags).some(key => key !== 'cover' && file.tags[key as keyof typeof file.tags] !== file.original[key as keyof typeof file.tags]));
}
export async function prepareOriginalFolderRenames(files: Mp3File[], targets: Mp3File[]) {
  const api = window.tagMaestroDesktop;
  const folders = targets.filter(f => f.editedFolderName !== f.folderName);
  if (!folders.length) return async (_files: Mp3File[], _update: (rows: Map<string, Mp3File>) => void) => 0;
  if (!api || folders.some(f => !canRenameOriginalFolder(f))) throw new Error('Original folder renaming requires the desktop app. Add the parent music library folder, not individual files or a single album. No copies were exported.');
  const groups = new Map<string, Map<string, Mp3File>>();
  for (const file of folders) {
    const key = file.librarySourceId!;
    const group = groups.get(key) || new Map<string, Mp3File>();
    const previous = group.get(file.folderPath);
    if (previous && previous.editedFolderName !== file.editedFolderName) throw new Error('Songs in one album have conflicting folder names');
    group.set(file.folderPath, file); groups.set(key, group);
  }
  // Prevent an unselected row in the same folder from requesting a different rename.
  for (const file of files) {
    const representative = groups.get(file.librarySourceId || '')?.get(file.folderPath);
    if (representative && file.editedFolderName !== file.folderName && representative.editedFolderName !== file.editedFolderName) throw new Error('Songs in one album have conflicting folder names');
  }
  const batches: { sourceId: string; rootName: string; transaction: string; folders: Map<string, Mp3File> }[] = [];
  for (const [sourceId, group] of groups) {
    const rootName = [...group.values()][0].folderPath.split('/')[0];
    let token = rootTokens.get(sourceId);
    if (!token) {
      const chosen = await api.chooseRenameRoot(rootName);
      if (!chosen) throw new Error('Folder renaming cancelled; original files were not changed');
      token = chosen.token; rootTokens.set(sourceId, token);
    }
    const plans: Plan[] = [];
    for (const file of group.values()) {
      const live = await file.sourceHandle!.getFile();
      if (live.size !== file.file.size || live.lastModified !== file.file.lastModified) throw new Error(`${file.file.name} changed on disk; reload before saving`);
      const hash = await crypto.subtle.digest('SHA-256', await live.slice(0, 65536).arrayBuffer());
      plans.push({ relative: file.folderPath.split('/').slice(1).join('/'), name: file.editedFolderName, anchor: { name: live.name, size: live.size, modified: live.lastModified, digest: [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('') } });
    }
    try {
      batches.push({ sourceId, rootName, transaction: await api.prepareFolderRenames(token, plans), folders: group });
    } catch (error) { rootTokens.delete(sourceId); throw error; }
  }
  return async (currentFiles: Mp3File[], update: (rows: Map<string, Mp3File>) => void) => {
    let count = 0;
    for (const batch of batches) {
      const byFolder = new Map<string, Mp3File[]>();
      for (const file of currentFiles) {
        if (file.librarySourceId !== batch.sourceId) continue;
        const rows = byFolder.get(file.folderPath) || [];
        rows.push(file); byFolder.set(file.folderPath, rows);
      }
      const folderPaths = [...byFolder.keys()].sort();
      const findFirst = (value: string) => {
        let low = 0, high = folderPaths.length;
        while (low < high) { const mid = (low + high) >>> 1; if (folderPaths[mid] < value) low = mid + 1; else high = mid; }
        return low;
      };
      const result = await api.commitFolderRenames(batch.transaction);
      const changed = new Map<string, Mp3File>();
      const prefixes: { old: string; next: string }[] = [];
      let reboundError = '';
      for (const receipt of result.renamed) {
        const oldPrefix = `${batch.rootName}/${receipt.relative}`;
        const representative = batch.folders.get(oldPrefix)!;
        const newPrefix = oldPrefix.slice(0, oldPrefix.lastIndexOf('/') + 1) + receipt.name;
        prefixes.push({ old: oldPrefix, next: newPrefix });
        const prefix = (value: string) => value === oldPrefix || value.startsWith(oldPrefix + '/') ? newPrefix + value.slice(oldPrefix.length) : value;
        const affected = [...(byFolder.get(oldPrefix) || [])];
        const descendantPrefix = oldPrefix + '/';
        for (let index = findFirst(descendantPrefix); index < folderPaths.length && folderPaths[index].startsWith(descendantPrefix); index++) affected.push(...byFolder.get(folderPaths[index])!);
        for (const file of affected) {
          const direct = file.folderPath === oldPrefix;
          const row: Mp3File = { ...file, folderPath: prefix(file.folderPath), folderName: direct ? receipt.name : file.folderName, editedFolderName: direct ? receipt.name : file.editedFolderName, libraryRelativePath: file.libraryRelativePath ? prefix(file.libraryRelativePath) : undefined, meta: { ...file.meta, path: prefix(file.meta.path) }, dirty: hasTagEdits(file) || Boolean(file.renamedBase) || (!direct && file.editedFolderName !== file.folderName), sourceHandle: undefined, sourceDirectoryHandle: undefined };
          try {
            let parent = representative.sourceFolderParentHandle!;
            let directory = await parent.getDirectoryHandle(receipt.name);
            for (const part of file.folderPath.slice(oldPrefix.length).split('/').filter(Boolean)) { parent = directory; directory = await directory.getDirectoryHandle(part); }
            row.sourceDirectoryHandle = directory;
            row.sourceFolderParentHandle = parent;
            row.sourceHandle = await directory.getFileHandle(file.file.name);
            row.file = await row.sourceHandle.getFile();
          } catch { reboundError = 'Folders were renamed, but some file handles need refreshing. Reload the library before further saving.'; }
          changed.set(file.id, row);
        }
        count++;
      }
      update(changed);
      if (prefixes.length) {
        const source = (await listLibrarySources()).find(s => s.id === batch.sourceId);
        if (source) await saveLibrarySource({ ...source, excludedPaths: source.excludedPaths.map(p => { const match = prefixes.find(v => p.startsWith(v.old + '/')); return match ? match.next + p.slice(match.old.length) : p; }) });
      }
      if (result.error || reboundError) throw new Error(result.error || reboundError);
    }
    return count;
  };
}
