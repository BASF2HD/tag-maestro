import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Toaster, toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagFieldCombo, KEEP_TAG_VALUE as MULTI } from "@/components/TagFieldCombo";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  Save,
  Wand2,
  Image as ImageIcon,
  FileText,
  Download,
  Loader2,
  Search,
  MoreVertical,
  FolderOpen,
  FolderTree,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Sun,
  Moon,
  ChevronDown,
  Trash2,
  Play,
  Pause,
  X,
} from "@/components/icons";
import {
  readMp3,
  audioRow,
  readEmbeddedArtwork,
  writeTagsToBlob,
  dataUrlToCover,
  renameByPattern,
  emptyTags,
  SUPPORTED_EXTS,
  SUPPORTED_ACCEPT,
  extractFolderName,
  type Mp3File,
  type Mp3Tags,
  type FileMeta,
} from "@/lib/mp3";
import { FolderRenameDialog } from "@/components/FolderRenameDialog";
import { LibraryNamesDialog } from "@/components/LibraryNamesDialog";
import { readMetadataCache, saveMetadataCache } from '@/lib/metadata-cache';
import { CoverCleanupDialog } from "@/components/CoverCleanupDialog";
import { EditableTableCell as TdCell } from "@/components/EditableTableCell";
import { writeVerifiedFile } from "@/lib/verified-file-write";
import { canRenameOriginalFolder, hasTagEdits, prepareOriginalFolderRenames } from "@/lib/folder-renames";
import { AudioPreview, type PreviewState } from "@/lib/audio-preview";
import { deleteSongBatch, nextAfterDeletion } from "@/lib/delete-song";
import { PreviewTransport, RowSeekControl } from "@/components/PreviewControls";
import { previewPage, previewScrollTop } from "@/lib/preview-visibility";
import { defaultTableSettings, loadTableSettings, saveTableSettings } from "@/lib/table-settings";
import { BulkFieldEditDialog, type BulkFieldKey } from "@/components/BulkFieldEditDialog";
import { ExtractTextDialog, type ExtractTargetKey } from "@/components/ExtractTextDialog";
import {
  SplitTextToTagsDialog,
  type SplitTagPatch,
} from "@/components/SplitTextToTagsDialog";
import {
  TagConverterDialog,
  type ConverterPatch,
} from "@/components/TagConverterDialog";
import {
  clearLibrarySources,
  excludeLibraryPaths,
  listLibrarySources,
  removeLibrarySource,
  saveLibrarySource,
  type StoredLibrarySource,
} from "@/lib/library-storage";

export const Route = createFileRoute("/")({
  component: TagMaestro,
});

type TagKey = keyof Omit<Mp3Tags, "cover">;
type MetaKey = keyof FileMeta;

type ColumnKind = "tag" | "filename" | "path" | "cover" | "meta" | "folder";
type TableColumnKey = TagKey | "filename" | "path" | "cover" | "folder" | MetaKey;

type TableColumn = {
  key: TableColumnKey;
  label: string;
  kind: ColumnKind;
  className?: string;
  defaultVisible?: boolean;
};

type ImportProgress = {
  title: string;
  message: string;
  loaded?: number;
  total?: number;
};

type FolderFileEntry = {
  file: File;
  relativePath: string;
  handle?: FileSystemFileHandle;
  parentHandle?: FileSystemDirectoryHandle;
  folderParentHandle?: FileSystemDirectoryHandle;
  libraryPath?: string;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
};

type WritableFileHandle = FileSystemFileHandle & {
  createWritable: () => Promise<FileSystemWritableFileStream>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type PermissionedHandle = FileSystemHandle & {
  isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type LoadOptions = {
  sourceId?: string;
  silent?: boolean;
  generation?: number;
  streaming?: boolean;
  onSkipped?: (count: number) => void;
};

const FIELDS: { key: TagKey; label: string }[] = [
  { key: "track", label: "Track" },
  { key: "title", label: "Title" },
  { key: "album", label: "Album" },
  { key: "artist", label: "Artist" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "year", label: "Year" },
  { key: "tag", label: "Tag" },
  { key: "genre", label: "Genre" },
  { key: "discnumber", label: "Discnumber" },
  { key: "comment", label: "Comment" },
  { key: "bpm", label: "BPM" },
];

const TABLE_COLUMNS: TableColumn[] = [
  { key: "track", label: "Track", kind: "tag", className: "w-14", defaultVisible: true },
  { key: "folder" as TableColumnKey, label: "Folder", kind: "folder" as ColumnKind, defaultVisible: true },
  { key: "filename", label: "Filename", kind: "filename", defaultVisible: true },
  { key: "path", label: "Path", kind: "path", defaultVisible: false },
  { key: "title", label: "Title", kind: "tag", defaultVisible: true },
  { key: "album", label: "Album", kind: "tag", defaultVisible: true },
  { key: "artist", label: "Artist", kind: "tag", defaultVisible: true },
  { key: "albumArtist", label: "Album Artist", kind: "tag", defaultVisible: true },
  { key: "composer", label: "Composer", kind: "tag", defaultVisible: true },
  { key: "year", label: "Year", kind: "tag", className: "w-16", defaultVisible: true },
  { key: "tag", label: "Tag", kind: "tag", defaultVisible: false },
  { key: "genre", label: "Genre", kind: "tag", defaultVisible: true },
  { key: "discnumber", label: "Discnumber", kind: "tag", className: "w-16", defaultVisible: true },
  { key: "comment", label: "Comment", kind: "tag", defaultVisible: true },
  { key: "bpm", label: "BPM", kind: "tag", className: "w-14", defaultVisible: false },
  { key: "cover", label: "Cover", kind: "cover", className: "w-14", defaultVisible: false },
  { key: "codec", label: "Codec", kind: "meta", defaultVisible: false },
  { key: "bitrate", label: "Bitrate", kind: "meta", defaultVisible: false },
  { key: "frequency", label: "Frequency", kind: "meta", defaultVisible: false },
  { key: "length", label: "Length", kind: "meta", className: "w-14", defaultVisible: true },
  { key: "vbr", label: "VBR", kind: "meta", className: "w-12", defaultVisible: false },
  { key: "mode", label: "Mode", kind: "meta", defaultVisible: false },
  { key: "size", label: "Size", kind: "meta", defaultVisible: false },
  { key: "modified", label: "Modified", kind: "meta", defaultVisible: false },
];

const DEFAULT_VISIBLE_COLUMNS = new Set(
  TABLE_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key),
);
const DEFAULT_TABLE_SETTINGS = defaultTableSettings<TableColumnKey>(
  TABLE_COLUMNS.map((column) => column.key), [...DEFAULT_VISIBLE_COLUMNS],
);

const EDITOR_MIN_WIDTH = 280;
const EDITOR_MAX_WIDTH = 620;
const EDITOR_DEFAULT_WIDTH = 340;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSavedEditorWidth() {
  if (typeof window === "undefined") return EDITOR_DEFAULT_WIDTH;
  try {
    const saved = Number(window.localStorage.getItem("editorWidth"));
    return Number.isFinite(saved)
      ? clamp(saved, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH)
      : EDITOR_DEFAULT_WIDTH;
  } catch {
    return EDITOR_DEFAULT_WIDTH;
  }
}

function getSavedTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const savedTheme = window.localStorage.getItem("theme");
    return savedTheme === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyThemeClass(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
  }
}

function asFolderEntry(item: File | FolderFileEntry): FolderFileEntry {
  if ("file" in item) return item;
  return {
    file: item,
    relativePath: (item as File & { webkitRelativePath?: string }).webkitRelativePath || item.name,
  };
}

async function collectDirectoryEntries(
  directoryHandle: FileSystemDirectoryHandle,
  onProgress?: (count: number, currentDir: string) => void,
  shouldCancel?: () => boolean,
  onBatch?: (entries: FolderFileEntry[]) => Promise<void>,
): Promise<FolderFileEntry[]> {
  const entries: FolderFileEntry[] = [];
  let found = 0;
  const pauseForPaint = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  let lastPaintTime = Date.now();

  async function walk(handle: FileSystemDirectoryHandle, path: string, folderParentHandle?: FileSystemDirectoryHandle) {
    if (shouldCancel?.()) return;
    for await (const [name, child] of (handle as any).entries()) {
      if (shouldCancel?.()) return;
      // Recovery folders from an explicitly approved overwrite are not live albums.
      if (name.startsWith(".tag-maestro-replaced-")) continue;
      const relativePath = path ? `${path}/${name}` : name;
      if (child.kind === "directory") {
        onProgress?.(found, relativePath);
        if (Date.now() - lastPaintTime > 150) {
          lastPaintTime = Date.now();
          await pauseForPaint();
        }
        await walk(child as FileSystemDirectoryHandle, relativePath, handle);
      } else if (child.kind === "file") {
        if (!SUPPORTED_EXTS.some(ext => name.toLowerCase().endsWith(ext))) continue;
        const fileHandle = child as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        entries.push({ file, relativePath, handle: fileHandle, parentHandle: handle, folderParentHandle });
        found++;
        if (onBatch && entries.length >= 100) await onBatch(entries.splice(0));
        if (found % 50 === 0 || Date.now() - lastPaintTime > 150) {
          lastPaintTime = Date.now();
          onProgress?.(found, path);
          await pauseForPaint();
        }
      }
    }
  }

  await walk(directoryHandle, directoryHandle.name);
  if (onBatch && entries.length && !shouldCancel?.()) await onBatch(entries.splice(0));
  return entries;
}

async function ensureWritePermission(handle: WritableFileHandle): Promise<boolean> {
  const descriptor = { mode: "readwrite" as const };
  if (handle.queryPermission) {
    const state = await handle.queryPermission(descriptor);
    if (state === "granted") return true;
  }
  if (handle.requestPermission) {
    return (await handle.requestPermission(descriptor)) === "granted";
  }
  return true;
}

async function handlePermission(
  handle: PermissionedHandle,
  requestAccess: boolean,
): Promise<PermissionState> {
  const descriptor = { mode: "readwrite" as const };
  const current = handle.queryPermission ? await handle.queryPermission(descriptor) : "granted";
  if (current !== "prompt" || !requestAccess || !handle.requestPermission) return current;
  return handle.requestPermission(descriptor);
}

function cloneTags(t: Mp3Tags): Mp3Tags {
  return structuredClone({ ...t, cover: t.cover ? { ...t.cover } : undefined });
}

export function TagMaestro() {
  const [theme, setTheme] = useState<"light" | "dark">(getSavedTheme);
  const [themeReady, setThemeReady] = useState(false);

  useLayoutEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    setThemeReady(true);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage may be unavailable in private or embedded browser contexts */
    }
  }, [theme]);

  const [files, setFiles] = useState<Mp3File[]>([]);
  const [preview, setPreview] = useState<PreviewState>({ id: null, playing: false, loading: false });
  const previewRef = useRef<AudioPreview | null>(null);
  const deletingRef = useRef(false);
  useEffect(() => {
    const player = new AudioPreview(new Audio(), setPreview, (message) => toast.error(message));
    previewRef.current = player;
    return () => {
      player.destroy();
      previewRef.current = null;
    };
  }, []);
  useEffect(() => {
    const player = previewRef.current;
    if (player?.state.id && !files.some((file) => file.id === player.state.id)) player.stop();
  }, [files]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [pattern] = useState("%artist% - %title%");
  const [filter, setFilter] = useState("");
  const [folderRenameOpen, setFolderRenameOpen] = useState(false);
  const [libraryNamesOpen, setLibraryNamesOpen] = useState(false);
  const [coverCleanupOpen, setCoverCleanupOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);
  const [extractTextOpen, setExtractTextOpen] = useState(false);
  const [splitTextOpen, setSplitTextOpen] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [pendingLibrarySources, setPendingLibrarySources] = useState<StoredLibrarySource[]>([]);
  const [editorWidth, setEditorWidth] = useState(getSavedEditorWidth);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const rootFolderInput = useRef<HTMLInputElement>(null);
  const coverProbeIds = useRef<Set<string>>(new Set());
  const libraryRestoreStarted = useRef(false);
  const libraryLoadGeneration = useRef(0);
  const isPickingRef = useRef(false);

  const cancelImport = useCallback(() => {
    libraryLoadGeneration.current += 1;
    setBusy(null);
    setImportProgress(null);
    toast.info("Import cancelled");
  }, []);

  useEffect(() => {
    localStorage.setItem("editorWidth", String(editorWidth));
  }, [editorWidth]);

  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.id)),
    [files, selected],
  );

  const hasDirtyFiles = useMemo(() => {
    return files.some((f) => f.dirty);
  }, [files]);
  const selectedDirty = selectedFiles.filter((file) => file.dirty);
  const saveTargets = selectedDirty.length ? selectedDirty : files.filter((file) => file.dirty);
  const savesOriginals = saveTargets.length > 0 && saveTargets.every((file) =>
    file.sourceHandle && (file.editedFolderName === file.folderName || canRenameOriginalFolder(file)) &&
      (directSaveFilename(file) === file.file.name || file.sourceDirectoryHandle),
  );

  const firstSelectedFile = selectedFiles[0];
  useEffect(() => {
    const first = firstSelectedFile;
    if (!first || first.coverEdited || first.tags.cover || coverProbeIds.current.has(first.id)) return;
    coverProbeIds.current.add(first.id);
    let cancelled = false;
    let settled = false;
    void readEmbeddedArtwork(first.file).then((cover) => {
      settled = true;
      if (cancelled) {
        coverProbeIds.current.delete(first.id);
        return;
      }
      if (!cover) return;
      setFiles((prev) => prev.map((f) =>
        f.id === first.id && f.file === first.file && !f.coverEdited && !f.tags.cover
          ? { ...f, tags: { ...f.tags, cover }, original: { ...f.original, cover } }
          : f,
      ));
    }).catch(() => {
      settled = true;
      coverProbeIds.current.delete(first.id);
      if (!cancelled) toast.error("Could not read the embedded artwork. Reload tags to retry.");
    });
    return () => {
      cancelled = true;
      if (!settled) coverProbeIds.current.delete(first.id);
    };
  }, [firstSelectedFile?.id, firstSelectedFile?.file, firstSelectedFile?.coverEdited, firstSelectedFile?.tags.cover]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.file.name.toLowerCase().includes(q) ||
        (f.renamedBase && f.renamedBase.toLowerCase().includes(q)) ||
        f.tags.title.toLowerCase().includes(q) ||
        f.tags.artist.toLowerCase().includes(q) ||
        f.tags.album.toLowerCase().includes(q) ||
        f.editedFolderName.toLowerCase().includes(q),
    );
  }, [files, filter]);

  const handleAdd = useCallback(async (
    list: FileList | File[] | FolderFileEntry[],
    options: LoadOptions = {},
  ) => {
    const source = list as ArrayLike<File | FolderFileEntry>;
    const entries = Array.from({ length: list.length }, (_, index) => asFolderEntry(source[index]));
    const arr = entries.filter((entry) => {
      const n = entry.file.name.toLowerCase();
      return SUPPORTED_EXTS.some((ext) => n.endsWith(ext));
    });
    if (!arr.length) {
      toast.error("No recognised music files. Choose MP3, M4A, AAC, FLAC, WAV, Ogg, Opus, AIFF or another supported music container.");
      return;
    }
    setBusy(`Reading ${arr.length} file${arr.length > 1 ? "s" : ""}…`);
    try {
      const skipAudio = arr.length > 10;
      const loaded = await Promise.all(
        arr.map(async (entry) => ({
          ...(await readMp3(
            entry.file,
            entry.relativePath,
            skipAudio,
            !skipAudio,
            entry.handle,
            entry.parentHandle,
          )),
          librarySourceId: options.sourceId,
          sourceFolderParentHandle: entry.folderParentHandle,
          libraryRelativePath: options.sourceId
            ? (entry.libraryPath ?? entry.relativePath)
            : undefined,
        })),
      );
      if (
        options.generation !== undefined &&
        options.generation !== libraryLoadGeneration.current
      ) {
        return 0;
      }
      setFiles((prev) => {
        if (!options.sourceId) return [...prev, ...loaded];
        const existingPaths = new Set(
          prev
            .filter((file) => file.librarySourceId === options.sourceId)
            .map((file) => file.libraryRelativePath),
        );
        return [
          ...prev,
          ...loaded.filter((file) => !existingPaths.has(file.libraryRelativePath)),
        ];
      });
      if (!options.silent) {
        toast.success(`Loaded ${loaded.length} file${loaded.length > 1 ? "s" : ""}`);
      }
      return loaded.length;
    } finally {
      setBusy(null);
    }
  }, []);

  const loadFileHandles = useCallback(async (handles: FileSystemFileHandle[]) => {
    let sourceId: string | undefined;
    try {
      if (!handles.length) return;
      sourceId = crypto.randomUUID();
      const source: StoredLibrarySource = {
        id: sourceId,
        kind: "files",
        name: handles.length === 1 ? handles[0].name : `${handles.length} selected files`,
        handles,
        excludedPaths: [],
        addedAt: Date.now(),
      };
      await saveLibrarySource(source);
      const entries = await Promise.all(
        handles.map(async (handle, index) => ({
          file: await handle.getFile(),
          relativePath: handle.name,
          libraryPath: `${index}:${handle.name}`,
          handle,
        })),
      );
      const loaded = await handleAdd(entries, {
        sourceId,
        generation: libraryLoadGeneration.current,
      });
      if (!loaded) await removeLibrarySource(sourceId);
    } catch (error) {
      if (sourceId) await removeLibrarySource(sourceId).catch(() => undefined);
      if ((error as { name?: string })?.name !== "AbortError") {
        toast.error((error as { message?: string })?.message || "File open failed");
      }
      setBusy(null);
    }
  }, [handleAdd]);

  const openFilePicker = useCallback(async () => {
    if (isPickingRef.current) return;
    const picker = (window as DirectoryPickerWindow).showOpenFilePicker;
    if (!picker) {
      fileInput.current?.click();
      return;
    }
    isPickingRef.current = true;
    try {
      const handles = await picker.call(window, { multiple: true });
      await loadFileHandles(handles);
    } catch (error: any) {
      if (error?.name !== "AbortError" && !error?.message?.includes("already active")) {
        toast.error(error?.message || "File open failed");
      }
    } finally {
      isPickingRef.current = false;
    }
  }, [loadFileHandles]);

  /** Handle adding files from a folder picker (single folder or root with subfolders). */
  const handleAddFolder = useCallback(async (
    list: FileList | File[] | FolderFileEntry[],
    options: LoadOptions = {},
  ) => {
    const pickedCount = list.length;
    const source = list as ArrayLike<File | FolderFileEntry>;
    const pauseForPaint = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    setBusy(`Scanning selected folder…`);
    setImportProgress({
      title: "Scanning folder",
      message: `Checking ${pickedCount} selected item${pickedCount === 1 ? "" : "s"} for supported audio files…`,
    });
    await pauseForPaint();

    const audioFiles: FolderFileEntry[] = [];

    // Scan once to avoid duplicating very large folder selections in memory.
    for (let i = 0; i < pickedCount; i++) {
      const entry = asFolderEntry(source[i]);
      const f = entry.file;
      const n = f.name.toLowerCase();
      if (SUPPORTED_EXTS.some((ext) => n.endsWith(ext))) {
        audioFiles.push(entry);
      }

      if (i > 0 && i % 1000 === 0) {
        setImportProgress({
          title: "Scanning folder",
          message: `Checked ${i.toLocaleString()} items. Found ${audioFiles.length.toLocaleString()} audio files…`,
        });
        await pauseForPaint();
      }
    }

    if (!audioFiles.length) {
      if (!options.streaming) { setImportProgress(null); setBusy(null); }
      if (!options.silent) toast.error("No supported audio files found in folder");
      return 0;
    }

    // Process audio files in batches for smooth progress
    const BATCH = 100;
    const total = audioFiles.length;
    let loadedCount = 0;
    let skippedCount = 0;
    setBusy(`Reading files… 0/${total}`);
    setImportProgress({
      title: "Reading audio tags",
      message: `Found ${total} supported audio file${total === 1 ? "" : "s"}. Loading metadata now…`,
      loaded: 0,
      total,
    });
    try {
      for (let i = 0; i < total; i += BATCH) {
        if (
          options.generation !== undefined &&
          options.generation !== libraryLoadGeneration.current
        ) {
          break;
        }
        const batch = audioFiles.slice(i, i + BATCH);
        const cached = await readMetadataCache(options.sourceId, batch.map(entry => ({ file: entry.file, path: entry.libraryPath ?? entry.relativePath })));
        const loaded: Mp3File[] = [];
        // Four concurrent readers keep the NAS responsive instead of launching 25 reads.
        for (let at = 0; at < batch.length; at += 4) {
          if (options.generation !== undefined && options.generation !== libraryLoadGeneration.current) break;
          const group = await Promise.all(batch.slice(at, at + 4).map(async (entry): Promise<Mp3File | null> => {
            try {
            const hit = cached.get(entry.libraryPath ?? entry.relativePath);
            return {
            ...(hit ? audioRow(entry.file, entry.relativePath, structuredClone(hit.tags), { ...hit.meta, path: entry.relativePath }, entry.handle, entry.parentHandle) : await readMp3(
              entry.file,
              entry.relativePath,
              true,
              false,
              entry.handle,
              entry.parentHandle,
            )),
            librarySourceId: options.sourceId,
            sourceFolderParentHandle: entry.folderParentHandle,
            libraryRelativePath: options.sourceId
              ? (entry.libraryPath ?? entry.relativePath)
              : undefined,
          }; } catch (error) {
            skippedCount++;
            console.warn('Skipped unreadable audio file:', entry.relativePath, error);
            return null;
          } }));
          loaded.push(...group.filter((row): row is Mp3File => row !== null));
        }
        if (options.generation !== undefined && options.generation !== libraryLoadGeneration.current) break;
        await saveMetadataCache(options.sourceId, loaded);


        setFiles((prev) => {
          if (!options.sourceId) return [...prev, ...loaded];
          const existingPaths = new Set(
            prev
              .filter((file) => file.librarySourceId === options.sourceId)
              .map((file) => file.libraryRelativePath),
          );
          return [
            ...prev,
            ...loaded.filter((file) => !existingPaths.has(file.libraryRelativePath)),
          ];
        });
        loadedCount += loaded.length;
        setBusy(`Reading files… ${loadedCount}/${total}`);
        setImportProgress({
          title: "Reading audio tags",
          message: "Loading files into the table…",
          loaded: loadedCount,
          total,
        });
        await pauseForPaint();
      }
      if (!options.silent) {
        toast.success(`Loaded ${loadedCount} file${loadedCount > 1 ? "s" : ""} from folder`);
        if (skippedCount) toast.info(`Skipped ${skippedCount} unreadable audio files. The remaining library was loaded.`);
      }
    } finally {
      if (!options.streaming && (options.generation === undefined || options.generation === libraryLoadGeneration.current)) {
        setBusy(null); setImportProgress(null);
      }
    }
    if (skippedCount) options.onSkipped?.(skippedCount);
    return loadedCount;
  }, []);

  const loadDirectoryHandle = useCallback(async (
    directoryHandle: FileSystemDirectoryHandle,
  ) => {
    const generation = libraryLoadGeneration.current;
    try {
      const savedSources = (await listLibrarySources()).filter(
        (source): source is Extract<StoredLibrarySource, { kind: "directory" }> =>
          source.kind === "directory",
      );
      const permissionedHandle = directoryHandle as PermissionedHandle;
      let previousSource: StoredLibrarySource | undefined;
      if (permissionedHandle.isSameEntry) {
        for (const candidate of savedSources) {
          if (await permissionedHandle.isSameEntry(candidate.handle)) {
            previousSource = candidate;
            break;
          }
        }
      }
      const source: StoredLibrarySource = {
        id: previousSource?.id ?? crypto.randomUUID(),
        kind: "directory",
        name: directoryHandle.name,
        handle: directoryHandle,
        excludedPaths: [],
        addedAt: previousSource?.addedAt ?? Date.now(),
      };
      await saveLibrarySource(source);
      setPendingLibrarySources((prev) => prev.filter((item) => item.id !== source.id));
      setFiles((prev) => prev.filter((file) => file.librarySourceId !== source.id));
      setBusy("Scanning folder…");
      setImportProgress({
        title: "Scanning folder",
        message: `Scanning ${directoryHandle.name}…`,
      });
      let loaded = 0, skipped = 0;
      await collectDirectoryEntries(
        directoryHandle,
        (count, currentDir) => {
          setImportProgress({
            title: "Scanning folder",
            message: `Found ${count.toLocaleString()} item${count === 1 ? "" : "s"} so far in ${currentDir || directoryHandle.name}…`,
          });
        },
        () => generation !== libraryLoadGeneration.current,
        async entries => { loaded += await handleAddFolder(entries, { sourceId: source.id, generation, silent: true, streaming: true, onSkipped: count => { skipped += count; } }); },
      );
      if (generation !== libraryLoadGeneration.current) return;
      if (!loaded) await removeLibrarySource(source.id);
      else toast.success(`Loaded ${loaded.toLocaleString()} songs. Archive renaming is available in Folder & archive names.`);
      if (skipped) toast.info(`Skipped ${skipped.toLocaleString()} unreadable audio files. Other albums were still loaded.`);
    } catch (e: any) {
      if (e?.name !== "AbortError" && !e?.message?.includes("already active")) {
        console.error('Folder loading failed:', e);
        toast.error(e?.message || "Folder open failed");
      }
    } finally {
      if (generation === libraryLoadGeneration.current) { setBusy(null); setImportProgress(null); }
    }
  }, [handleAddFolder]);

  const openFolderPicker = useCallback(async (fallbackInput: HTMLInputElement | null) => {
    if (isPickingRef.current) return;
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      fallbackInput?.click();
      return;
    }

    isPickingRef.current = true;
    try {
      const directoryHandle = await picker.call(window, { mode: "readwrite" });
      await loadDirectoryHandle(directoryHandle);
    } catch (error: any) {
      if (error?.name !== "AbortError" && !error?.message?.includes("already active")) {
        toast.error(error?.message || "Folder open failed");
      }
    } finally {
      isPickingRef.current = false;
    }
  }, [loadDirectoryHandle]);

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    const items = Array.from(event.dataTransfer.items) as Array<
      DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
      }
    >;
    const handleItems = items.filter(
      (item) => item.kind === "file" && item.getAsFileSystemHandle,
    );

    if (handleItems.length) {
      try {
        const handles = (await Promise.all(
          handleItems.map((item) => item.getAsFileSystemHandle!()),
        )).filter((handle): handle is FileSystemHandle => Boolean(handle));
        const directories = handles.filter(
          (handle): handle is FileSystemDirectoryHandle => handle.kind === "directory",
        );
        const droppedFiles = handles.filter(
          (handle): handle is FileSystemFileHandle => handle.kind === "file",
        );
        for (const directory of directories) await loadDirectoryHandle(directory);
        if (droppedFiles.length) await loadFileHandles(droppedFiles);
        if (handles.length) return;
      } catch (error) {
        toast.error((error as { message?: string })?.message || "Dropped items could not be opened");
        return;
      }
    }

    if (event.dataTransfer.files.length) {
      await handleAdd(event.dataTransfer.files);
    }
  }

  const restoreLibrarySources = useCallback(async (
    sources: StoredLibrarySource[],
    requestAccess: boolean,
  ) => {
    if (!sources.length) return;
    const restoreGeneration = libraryLoadGeneration.current;
    const stillPending: StoredLibrarySource[] = [];
    let restoredFiles = 0;

    for (const source of sources) {
      if (restoreGeneration !== libraryLoadGeneration.current) return;
      try {
        setBusy(`Restoring ${source.name}…`);
        const excluded = new Set(source.excludedPaths);
        if (source.kind === "directory") {
          const permission = await handlePermission(
            source.handle as PermissionedHandle,
            requestAccess,
          );
          if (permission !== "granted") {
            stillPending.push(source);
            continue;
          }
          await collectDirectoryEntries(source.handle, undefined,
            () => restoreGeneration !== libraryLoadGeneration.current,
            async entries => {
              restoredFiles += await handleAddFolder(entries.filter(entry => !excluded.has(entry.relativePath)), {
                sourceId: source.id, silent: true, streaming: true, generation: restoreGeneration,
              });
            },
          );
        } else {
          const entries: FolderFileEntry[] = [];
          let needsPermission = false;
          for (let index = 0; index < source.handles.length; index++) {
            const handle = source.handles[index];
            const libraryPath = `${index}:${handle.name}`;
            if (excluded.has(libraryPath)) continue;
            const permission = await handlePermission(handle as PermissionedHandle, requestAccess);
            if (permission !== "granted") {
              needsPermission = true;
              break;
            }
            entries.push({
              file: await handle.getFile(),
              relativePath: handle.name,
              libraryPath,
              handle,
            });
          }
          if (needsPermission) {
            stillPending.push(source);
            continue;
          }
          restoredFiles += (await handleAdd(entries, {
            sourceId: source.id,
            silent: true,
            generation: restoreGeneration,
          })) || 0;
        }
      } catch {
        stillPending.push(source);
      }
    }

    if (restoreGeneration !== libraryLoadGeneration.current) return;
    setPendingLibrarySources(stillPending);
    setBusy(null);
    setImportProgress(null);
    if (restoredFiles > 0) {
      toast.success(
        `Restored ${restoredFiles.toLocaleString()} file${restoredFiles === 1 ? "" : "s"}`,
      );
    } else if (requestAccess && stillPending.length) {
      toast.error("Folder access was not granted. Your saved library is still available to restore.");
    }
  }, [handleAdd, handleAddFolder]);

  useEffect(() => {
    if (libraryRestoreStarted.current) return;
    libraryRestoreStarted.current = true;
    void listLibrarySources()
      .then((sources) => restoreLibrarySources(sources, false))
      .catch(() => toast.error("Could not read the saved library"));
  }, [restoreLibrarySources]);

  /** Update folder name for a single file, propagating to all files in the same original folder. */
  function updateFolderName(id: string, newName: string) {
    const target = files.find((f) => f.id === id);
    if (!target) return;
    const origFolder = target.folderName;
    setFiles((prev) =>
      prev.map((f) =>
        f.folderName === origFolder
          ? {
              ...f,
              editedFolderName: newName,
              dirty: f.folderName !== newName ? true : f.dirty,
            }
          : f,
      ),
    );
  }

  /** Update filename for a single file. */
  function updateFilename(id: string, newName: string) {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const origName = f.file.name;
        const dot = origName.lastIndexOf(".");
        const ext = dot > 0 ? origName.slice(dot) : "";
        let base = newName;
        if (ext && newName.toLowerCase().endsWith(ext.toLowerCase())) {
          base = newName.slice(0, newName.length - ext.length);
        }
        return {
          ...f,
          renamedBase: base,
          dirty: true,
        };
      }),
    );
  }

  /** Apply bulk folder renames from the dialog. */
  function handleFolderRenames(renames: Map<string, string>) {
    setFiles((prev) =>
      prev.map((f) => {
        const newName = renames.get(f.editedFolderName);
        return newName !== undefined
          ? {
              ...f,
              editedFolderName: newName,
              dirty: f.folderName !== newName ? true : f.dirty,
            }
          : f;
      }),
    );
    toast.success(`Renamed ${renames.size} folder${renames.size > 1 ? "s" : ""}`);
  }

  /** Apply bulk field edits (find/replace etc.) to per-file values. */
  function handleBulkFieldEdit(field: BulkFieldKey, changes: Map<string, string>) {
    setFiles((prev) =>
      prev.map((f) => {
        const next = changes.get(f.id);
        if (next === undefined) return f;
        if (field === "filename") {
          return { ...f, renamedBase: next, dirty: true };
        }
        if (field === "folder") {
          return { ...f, editedFolderName: next, dirty: true };
        }
        return { ...f, tags: { ...f.tags, [field]: next }, dirty: true };
      }),
    );
    toast.success(`Updated ${changes.size} file${changes.size > 1 ? "s" : ""}`);
  }

  function handleExtractText(field: ExtractTargetKey, changes: Map<string, string>) {
    setFiles((prev) =>
      prev.map((file) => {
        const value = changes.get(file.id);
        if (value === undefined) return file;
        if (field === "filename") return { ...file, renamedBase: value, dirty: true };
        return { ...file, tags: { ...file.tags, [field]: value }, dirty: true };
      }),
    );
    toast.success(`Updated ${changes.size} file${changes.size === 1 ? "" : "s"}`);
  }

  function handleSplitText(changes: Map<string, SplitTagPatch>) {
    setFiles((prev) =>
      prev.map((file) => {
        const patch = changes.get(file.id);
        return patch ? { ...file, tags: { ...file.tags, ...patch }, dirty: true } : file;
      }),
    );
    toast.success(`Split text into tags for ${changes.size} file${changes.size === 1 ? "" : "s"}`);
  }

  function handleConvert(changes: Map<string, ConverterPatch>) {
    setFiles((prev) =>
      prev.map((file) => {
        const patch = changes.get(file.id);
        if (!patch) return file;
        return {
          ...file,
          tags: patch.tags ? { ...file.tags, ...patch.tags } : file.tags,
          renamedBase: patch.renamedBase ?? file.renamedBase,
          dirty: true,
        };
      }),
    );
    toast.success(`Converted ${changes.size} file${changes.size === 1 ? "" : "s"}`);
  }

  /** Map of folder name -> array of file IDs for the rename dialog. */
  const folderMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of files) {
      const name = f.editedFolderName || f.folderName;
      if (!name) continue;
      const arr = m.get(name) || [];
      arr.push(f.id);
      m.set(name, arr);
    }
    return m;
  }, [files]);

  function updateTag(id: string, key: TagKey, value: string) {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, tags: { ...f.tags, [key]: value }, dirty: true } : f,
      ),
    );
  }

  function applyToSelected(patch: Partial<Mp3Tags>) {
    if (!selected.size) return;
    const editsCover = Object.prototype.hasOwnProperty.call(patch, "cover");
    // Choosing <keep> is a no-op, not an edit or an unsaved change.
    if (
      !editsCover &&
      !Object.values(patch).some((value) => value !== undefined && value !== MULTI)
    ) return;
    if (editsCover) selected.forEach((id) => coverProbeIds.current.add(id));
    setFiles((prev) =>
      prev.map((f) => {
        if (!selected.has(f.id)) return f;
        const next: Mp3Tags = { ...f.tags };
        for (const [k, v] of Object.entries(patch)) {
          if (k === "cover") {
            next.cover = v as Mp3Tags["cover"];
          } else if (v !== undefined && v !== MULTI) {
            (next as any)[k] = v;
          }
        }
        return { ...f, tags: next, dirty: true, coverEdited: editsCover || f.coverEdited };
      }),
    );
  }

  async function deleteSongs(ids: string[]): Promise<string[]> {
    if (busy || importProgress || deletingRef.current) return [];
    const requested = new Set(ids);
    const songs = files.filter((file) => requested.has(file.id));
    if (!songs.length) return [];
    deletingRef.current = true;
    try {
      const result = await deleteSongBatch(songs, (song, index) => {
        setBusy(`Deleting ${index + 1} of ${songs.length}: ${song.file.name}…`);
        if (previewRef.current?.state.id === song.id) previewRef.current.stop();
      });
      const deleted = new Set(result.deleted);
      if (deleted.size) {
        setFiles((previous) => previous.filter((file) => !deleted.has(file.id)));
        setSelected((previous) => new Set([...previous].filter((id) => !deleted.has(id))));
        const pathsBySource = new Map<string, string[]>();
        for (const song of songs) {
          if (!deleted.has(song.id)) continue;
          coverProbeIds.current.delete(song.id);
          if (song.librarySourceId && song.libraryRelativePath) {
            const paths = pathsBySource.get(song.librarySourceId) || [];
            paths.push(song.libraryRelativePath);
            pathsBySource.set(song.librarySourceId, paths);
          }
        }
        toast.success(`Deleted ${deleted.size} song file${deleted.size === 1 ? "" : "s"} from album folders`);
        for (const [sourceId, paths] of pathsBySource) {
          await excludeLibraryPaths(sourceId, paths).catch(() =>
            toast.error("Files were deleted, but saved-library storage could not be updated. Reload the folder."),
          );
        }
      }
      if (result.failed.length) {
        toast.error(`${result.failed.length} song file(s) not deleted; rows retained. ${result.failed[0].song.file.name}: ${result.failed[0].message}`);
      }
      return result.deleted;
    } finally {
      deletingRef.current = false;
      setBusy(null);
    }
  }

  async function removeSelected() {
    const removed = files.filter((file) => selected.has(file.id));
    const remaining = files.filter((file) => !selected.has(file.id));
    setFiles(remaining);
    setSelected(new Set());

    const pathsBySource = new Map<string, string[]>();
    for (const file of removed) {
      if (!file.librarySourceId || !file.libraryRelativePath) continue;
      const paths = pathsBySource.get(file.librarySourceId) ?? [];
      paths.push(file.libraryRelativePath);
      pathsBySource.set(file.librarySourceId, paths);
    }

    try {
      for (const [sourceId, paths] of pathsBySource) {
        const sourceStillLoaded = remaining.some((file) => file.librarySourceId === sourceId);
        if (sourceStillLoaded) await excludeLibraryPaths(sourceId, paths);
        else await removeLibrarySource(sourceId);
      }
    } catch {
      toast.error("Rows were removed, but the saved library could not be updated");
    }
  }

  async function removeAll() {
    if (!window.confirm("Remove all loaded files from TagMaestro? Files on disk will not be deleted.")) {
      return;
    }
    libraryLoadGeneration.current += 1;
    setFiles([]);
    setSelected(new Set());
    setPendingLibrarySources([]);
    coverProbeIds.current.clear();
    try {
      await clearLibrarySources();
      toast.success("Removed all loaded files");
    } catch {
      toast.error("Files were removed, but saved library storage could not be cleared");
    }
  }

  async function reloadTagsFromFiles() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return;
    const dirtyCount = targets.filter((file) => file.dirty).length;
    if (
      dirtyCount > 0 &&
      !window.confirm(
        `Reload tags for ${targets.length} file${targets.length === 1 ? "" : "s"}? ` +
          `${dirtyCount} file${dirtyCount === 1 ? " has" : "s have"} unsaved changes that will be replaced.`,
      )
    ) {
      return;
    }

    const refreshed = new Map<string, Mp3File>();
    let failed = 0;
    setBusy(`Reloading tags… 0/${targets.length}`);
    setImportProgress({
      title: "Reloading audio tags",
      message: "Reading metadata from the source files…",
      loaded: 0,
      total: targets.length,
    });
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const file = targets[index];
        try {
          const loaded = await readMp3(
            file.sourceHandle ? await file.sourceHandle.getFile() : file.file,
            file.meta.path || file.libraryRelativePath || file.file.name,
            true,
            true,
            file.sourceHandle,
            file.sourceDirectoryHandle,
          );
          refreshed.set(file.id, loaded);
          coverProbeIds.current.add(file.id);
        } catch {
          failed += 1;
        }
        const loadedCount = index + 1;
        setBusy(`Reloading tags… ${loadedCount}/${targets.length}`);
        setImportProgress({
          title: "Reloading audio tags",
          message: "Reading metadata from the source files…",
          loaded: loadedCount,
          total: targets.length,
        });
        if (loadedCount % 25 === 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }

      setFiles((current) =>
        current.map((file) => {
          const loaded = refreshed.get(file.id);
          return loaded ? { ...file, file: loaded.file, meta: { ...loaded.meta, path: file.meta.path }, tags: loaded.tags, original: cloneTags(loaded.tags), dirty: false, coverEdited: false } : file;
        }),
      );
      if (refreshed.size) {
        toast.success(`Reloaded tags for ${refreshed.size} file${refreshed.size === 1 ? "" : "s"}`);
      }
      if (failed) toast.error(`Could not reload ${failed} file${failed === 1 ? "" : "s"}`);
    } finally {
      setBusy(null);
      setImportProgress(null);
    }
  }

  async function saveAll() {
    const targets = saveTargets;
    if (!targets.length) return;
    const folderEdits = targets.some(m => m.editedFolderName !== m.folderName);
    if (folderEdits && !savesOriginals) {
      toast.error("To rename original folders, use the desktop app and Add Folder to open the parent music library. No copies were exported.");
      return;
    }
    const canSaveDirect = targets.every((m) => {
      if (m.editedFolderName !== m.folderName && !canRenameOriginalFolder(m)) return false;
      if (!m.sourceHandle) return false;
      const targetName = directSaveFilename(m);
      return targetName === m.file.name || Boolean(m.sourceDirectoryHandle);
    });
    setBusy(
      canSaveDirect
        ? `Saving ${targets.length} file${targets.length > 1 ? "s" : ""} directly…`
        : `Packaging ${targets.length} file${targets.length > 1 ? "s" : ""}…`,
    );
    try {
      if (canSaveDirect) {
        const commitFolders = await prepareOriginalFolderRenames(files, targets);
        const savedRows = new Map<string, Mp3File>();
        let saved = 0;
        for (const m of targets) {
          // A folder-only change does not rewrite song metadata or audio bytes.
          if (!hasTagEdits(m) && directSaveFilename(m) === m.file.name && m.editedFolderName !== m.folderName) continue;
          const originalHandle = m.sourceHandle as WritableFileHandle;
          const allowed = await ensureWritePermission(originalHandle);
          if (!allowed) throw new Error("Write permission was not granted for the selected folder");
          const live = await originalHandle.getFile();
          if (live.size !== m.file.size || live.lastModified !== m.file.lastModified) {
            throw new Error(`${m.file.name} changed on disk. Reload tags before saving; completed files remain saved.`);
          }

          const blob = await writeTagsToBlob(m);
          const targetName = directSaveFilename(m);
          const shouldRename = targetName !== m.file.name;
          let targetHandle = originalHandle;

          if (shouldRename) {
            const directory = m.sourceDirectoryHandle;
            if (!directory) {
              throw new Error("Open the containing folder to rename files directly");
            }
            try {
              const existing = await directory.getFileHandle(targetName);
              const sameEntry = (existing as PermissionedHandle).isSameEntry
                ? await (existing as PermissionedHandle).isSameEntry!(originalHandle)
                : false;
              if (sameEntry) {
                throw new Error("Case-only filename changes are not supported by this filesystem");
              }
              throw new Error("A file named \"" + targetName + "\" already exists");
            } catch (error) {
              if ((error as { name?: string }).name !== "NotFoundError") throw error;
            }
            targetHandle = await directory.getFileHandle(targetName, {
              create: true,
            }) as WritableFileHandle;
          }

          const verified = await writeVerifiedFile(targetHandle, blob);
          if (shouldRename) {
            await m.sourceDirectoryHandle!.removeEntry(m.file.name);
          }
          const relativePath = m.libraryRelativePath
            ? replacePathFilename(m.libraryRelativePath, targetName)
            : undefined;
          const savedRow: Mp3File = {
            ...m, file: verified, sourceHandle: targetHandle,
            libraryRelativePath: relativePath ?? m.libraryRelativePath,
            meta: { ...m.meta, path: replacePathFilename(m.meta.path, verified.name), size: `${(verified.size / (1024 * 1024)).toFixed(2)} MB`, modified: new Date(verified.lastModified).toLocaleString() },
            renamedBase: undefined, dirty: m.editedFolderName !== m.folderName, coverEdited: false, original: cloneTags(m.tags),
          };
          savedRows.set(m.id, savedRow);
          setFiles(prev => prev.map(f => f.id === m.id ? savedRow : f));
          saved += 1;
          setBusy(`Saving directly… ${saved}/${targets.length}`);
        }

        const renamedFolders = await commitFolders(files.map(f => savedRows.get(f.id) || f), rows => {
          setFiles(prev => prev.map(f => rows.get(f.id) || f));
        });
        toast.success([saved ? `Saved and verified ${saved} original file${saved > 1 ? "s" : ""}` : '', renamedFolders ? `Renamed ${renamedFolders} original folder${renamedFolders > 1 ? "s" : ""} without copying songs` : ''].filter(Boolean).join('. '));
      } else if (targets.length === 1 && targets[0].editedFolderName === targets[0].folderName) {
        const m = targets[0];
        const blob = await writeTagsToBlob(m);
        const name = renamedFilename(m, pattern);
        triggerDownload(blob, name);
        toast.info("Downloaded an edited copy. The original is unchanged. Use Add Folder in Chrome or Edge for direct saving.");
      } else {
        const zip = new JSZip();
        for (const m of targets) {
          const blob = await writeTagsToBlob(m);
          const name = renamedFilename(m, pattern);
          // If the file has a folder name specified, organize it into a subfolder
          const relativeFilePath = m.editedFolderName ? `${m.editedFolderName}/${name}` : name;
          zip.file(uniqueName(zip, relativeFilePath), blob);
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        triggerDownload(zipBlob, "tagmaestro-export.zip");
        toast.info("Downloaded edited copies as a ZIP. Originals are unchanged. Use Add Folder in Chrome or Edge for direct saving.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setBusy(null);
    }
  }

  function onCoverFile(fileInput: File) {
    if (!selected.size) return;
    const reader = new FileReader();
    reader.onload = () => {
      const cover = dataUrlToCover(String(reader.result));
      if (cover) applyToSelected({ cover });
    };
    reader.readAsDataURL(fileInput);
  }

  function startEditorResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = editorWidth;

    const onMove = (event: PointerEvent) => {
      const maxWidth = Math.min(EDITOR_MAX_WIDTH, Math.max(EDITOR_MIN_WIDTH, window.innerWidth - 420));
      setEditorWidth(clamp(startWidth + startX - event.clientX, EDITOR_MIN_WIDTH, maxWidth));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function adjustEditorWidth(delta: number) {
    setEditorWidth((width) => clamp(width + delta, EDITOR_MIN_WIDTH, EDITOR_MAX_WIDTH));
  }

  // ==== Panel state for the editor (multi-edit aware) ====
  const panelTags: Mp3Tags = useMemo(() => {
    if (!selectedFiles.length) return emptyTags();
    const base = selectedFiles[0].tags;
    if (selectedFiles.length === 1) return base;
    const merged: Mp3Tags = { ...emptyTags() };
    for (const k of FIELDS.map((f) => f.key)) {
      const same = selectedFiles.every((f) => f.tags[k] === base[k]);
      merged[k] = same ? base[k] : (MULTI as string);
    }
    const sameCover = selectedFiles.every(
      (f) => f.tags.cover?.dataUrl === base.cover?.dataUrl,
    );
    if (sameCover) merged.cover = base.cover;
    return merged;
  }, [selectedFiles]);

  return (
    <div
      className="h-screen max-h-screen min-h-0 bg-background text-foreground flex flex-col overflow-hidden supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Toaster />
      <LibraryNamesDialog open={libraryNamesOpen} onOpenChange={setLibraryNamesOpen} hasDirtyFiles={hasDirtyFiles} onSaved={async () => {
        libraryLoadGeneration.current += 1;
        previewRef.current?.stop();
        setFiles([]); setSelected(new Set()); setPendingLibrarySources([]);
        coverProbeIds.current.clear();
        await clearLibrarySources();
      }} />
      <FolderRenameDialog
        open={folderRenameOpen}
        onOpenChange={setFolderRenameOpen}
        folders={folderMap}
        onApply={handleFolderRenames}
      />
      <BulkFieldEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        files={selectedFiles.length ? selectedFiles : files}
        onApply={handleBulkFieldEdit}
      />
      <TagConverterDialog
        open={converterOpen}
        onOpenChange={setConverterOpen}
        files={selectedFiles.length ? selectedFiles : files}
        onApply={handleConvert}
      />
      <ExtractTextDialog
        open={extractTextOpen}
        onOpenChange={setExtractTextOpen}
        files={selectedFiles.length ? selectedFiles : files}
        onApply={handleExtractText}
      />
      <SplitTextToTagsDialog
        open={splitTextOpen}
        onOpenChange={setSplitTextOpen}
        files={selectedFiles.length ? selectedFiles : files}
        onApply={handleSplitText}
      />
      {/* Header */}
      <CoverCleanupDialog
        open={coverCleanupOpen}
        onOpenChange={setCoverCleanupOpen}
        files={files}
        onTracksSaved={updates => {
          const savedById = new Map(updates.map(update => [update.row.id, update]));
          setFiles(previous => previous.map(item => {
            const update = savedById.get(item.id);
            if (!update) return item;
            const { file: saved, cover } = update;
            return {
              ...item, file: saved, coverEdited: false, tags: { ...item.tags, cover }, original: { ...item.original, cover },
              meta: { ...item.meta, size: `${(saved.size / (1024 * 1024)).toFixed(2)} MB`, modified: new Date(saved.lastModified).toLocaleString() },
            };
          }));
        }}
      />
      <header className="relative z-30 shrink-0 border-b border-border bg-sidebar/60 backdrop-blur px-3 py-2 flex items-center gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <img src="/brand/tag-maestro-64.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-[4px]" />
          <div>
            <h1 className="whitespace-nowrap text-sm font-semibold tracking-tight">Tag Maestro</h1>
          </div>
        </div>

        <Separator orientation="vertical" className="h-7 mx-1" />

        <input
          ref={fileInput}
          type="file"
          multiple
          accept={SUPPORTED_ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files && handleAdd(e.target.files)}
        />
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          {...{ webkitdirectory: "", directory: "", multiple: true }}
          onChange={(e) => e.target.files && handleAddFolder(e.target.files)}
        />
        <input
          ref={rootFolderInput}
          type="file"
          className="hidden"
          {...{ webkitdirectory: "", directory: "", multiple: true }}
          onChange={(e) => e.target.files && handleAddFolder(e.target.files)}
        />
        <div className="hidden items-center gap-2 lg:flex">
          <Button size="sm" onClick={() => void openFilePicker()} disabled={Boolean(busy || importProgress)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Add files
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openFolderPicker(folderInput.current)} disabled={Boolean(busy || importProgress)}>
            <FolderOpen className="mr-1.5 h-4 w-4" />
            Add Folder
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openFolderPicker(rootFolderInput.current)} disabled={Boolean(busy || importProgress)}>
            <FolderTree className="mr-1.5 h-4 w-4" />
            Add Root Folder
          </Button>
        </div>
        <ToolbarMenu
          label="Open"
          icon={FolderOpen}
          className="lg:hidden"
          items={[
            { label: "Files", onSelect: () => void openFilePicker() },
            {
              label: "Folder",
              onSelect: () => void openFolderPicker(folderInput.current),
            },
            {
              label: "Root folder",
              onSelect: () => void openFolderPicker(rootFolderInput.current),
            },
          ]}
        />
        <Button size="sm" variant="outline" onClick={() => setLibraryNamesOpen(true)} disabled={Boolean(busy || importProgress)} title="Fast desktop folder and archive renaming (ZIP, RAR, 7z, tar) without reading audio files">Folder &amp; archive names</Button>
        {pendingLibrarySources.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void restoreLibrarySources(pendingLibrarySources, true)}
          >
            <FolderOpen className="mr-1.5 h-4 w-4" />
            Restore library ({pendingLibrarySources.length})
          </Button>
        )}
        <Button
          size="sm"
          variant={hasDirtyFiles ? "default" : "secondary"}
          onClick={saveAll}
          disabled={!hasDirtyFiles || Boolean(busy)}
          title={
            !hasDirtyFiles
              ? "No unsaved changes"
              : savesOriginals
                ? "Write and verify changes in original music files"
                : saveTargets.some(f => f.editedFolderName !== f.folderName)
                  ? "Original folder renaming requires the desktop app and the parent library folder. No copies will be exported."
                : "Download edited copies only. Originals are unchanged; use Add Folder in Chrome/Edge for direct saving."
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {hasDirtyFiles && !savesOriginals && !saveTargets.some(f => f.editedFolderName !== f.folderName) ? "Export copies" : "Save originals"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!files.length || Boolean(busy || importProgress)}
          onClick={() => setCoverCleanupOpen(true)}
          title="Codex cover cleanup"
          aria-label="Codex cover cleanup"
        >
          <ImageIcon className="h-4 w-4" />
          <span className="ml-1.5 hidden xl:inline">Cover cleanup</span>
        </Button>
        <ToolbarMenu
          label="Tools"
          icon={Wand2}
          disabled={!files.length}
          items={[
            { label: "Rename folders", onSelect: () => setFolderRenameOpen(true) },
            { label: "Bulk edit", onSelect: () => setBulkEditOpen(true) },
            { label: "Convert tags", onSelect: () => setConverterOpen(true) },
            { label: "Extract text to tag", onSelect: () => setExtractTextOpen(true) },
            { label: "Split text to tags", onSelect: () => setSplitTextOpen(true) },
            { label: "Reload tags from files", onSelect: () => void reloadTagsFromFiles() },
          ]}
        />
        <LoadedFilesMenu
          total={files.length}
          selected={selected.size}
          onRemoveSelected={() => void removeSelected()}
          onRemoveAll={() => void removeAll()}
        />

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="h-8 w-48 pl-7 text-xs max-lg:w-24"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            title={themeReady ? (theme === "light" ? "Switch to dark theme" : "Switch to light theme") : "Toggle theme"}
            suppressHydrationWarning
          >
            {themeReady && theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* File table */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {files.length === 0 ? (
            <>
              <EmptyState
                onFiles={() => void openFilePicker()}
                onFolder={() => void openFolderPicker(folderInput.current)}
                onRootFolder={() => void openFolderPicker(rootFolderInput.current)}
                disabled={Boolean(busy || importProgress)}
              />
              <div className="relative border-t border-border px-4 py-2 flex items-center justify-between text-xs bg-sidebar/40 backdrop-blur select-none h-11 shrink-0">
                <div className="min-w-0 flex flex-1 items-center gap-1 text-muted-foreground">
                  <span>0 tracks</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                  <ProgressOrStatus
                    importProgress={importProgress}
                    status={busy}
                    onCancel={cancelImport}
                  />
                </div>
                <div className="flex flex-1 justify-end" />
              </div>
            </>
          ) : (
            <FileTable
              files={filtered}
              selected={selected}
              filter={filter}
              status={busy && !importProgress ? busy : null}
              importProgress={importProgress}
              onCancelImport={cancelImport}
              onToggle={(id, additive) => {
                setSelected((prev) => {
                  const next = new Set(additive ? prev : []);
                  if (prev.has(id) && additive) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onSelectAll={setSelected}
              onEdit={updateTag}
              onEditFolder={updateFolderName}
              onEditFilename={updateFilename}
              onRemoveSelected={removeSelected}
              onRemoveAll={removeAll}
              preview={preview}
              previewPlayer={previewRef.current}
              activePreviewTrack={files.find((file) => file.id === preview.id)}
              allTracks={files}
              onRevealPreview={(id) => {
                if (!filtered.some((file) => file.id === id)) setFilter("");
              }}
              onPreview={(file) => void previewRef.current?.toggle(file)}
              onDelete={deleteSongs}
              actionsDisabled={Boolean(busy || importProgress)}
            />
          )}
        </main>

        {editorCollapsed ? (
          <div className="relative z-20 flex w-7 shrink-0 items-stretch justify-center border-l border-border bg-sidebar/40">
            <button
              type="button"
              className="grid h-full w-full place-items-center text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label="Show editor"
              title="Show editor"
              aria-expanded={false}
              onClick={() => setEditorCollapsed(false)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div
              role="separator"
              aria-label="Resize editor panel"
              aria-orientation="vertical"
              aria-valuemin={EDITOR_MIN_WIDTH}
              aria-valuemax={EDITOR_MAX_WIDTH}
              aria-valuenow={editorWidth}
              tabIndex={0}
              title="Drag to resize editor"
              className="group relative z-20 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-primary"
              onPointerDown={startEditorResize}
              onDoubleClick={() => setEditorWidth(EDITOR_DEFAULT_WIDTH)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  adjustEditorWidth(e.shiftKey ? 40 : 16);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  adjustEditorWidth(e.shiftKey ? -40 : -16);
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setEditorWidth(EDITOR_MIN_WIDTH);
                } else if (e.key === "End") {
                  e.preventDefault();
                  setEditorWidth(EDITOR_MAX_WIDTH);
                }
              }}
            >
              <span className="w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
            </div>

            {/* Editor panel */}
            <aside
              className="shrink-0 bg-sidebar/40 flex flex-col overflow-hidden"
              style={{ width: editorWidth }}
            >
              <EditorPanel
                tags={panelTags}
                count={selectedFiles.length}
                selectedFiles={selectedFiles}
                onChange={(key, value) => applyToSelected({ [key]: value })}
                onCoverPick={onCoverFile}
                onCoverDelete={() => applyToSelected({ cover: undefined })}
                onCollapse={() => setEditorCollapsed(true)}
              />
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

function ProgressOrStatus({
  importProgress,
  status,
  onCancel,
}: {
  importProgress?: ImportProgress | null;
  status?: string | null;
  onCancel?: () => void;
}) {
  if (importProgress) {
    const hasNums = typeof importProgress.loaded === "number" && typeof importProgress.total === "number";
    const pct = hasNums && importProgress.total ? Math.round((importProgress.loaded! / importProgress.total!) * 100) : 0;
    return (
      <div className="flex min-w-0 max-w-[320px] items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <span className="truncate font-medium text-foreground">{importProgress.title}</span>
        {hasNums ? (
          <>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted shrink-0">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] whitespace-nowrap shrink-0 text-foreground font-mono">
              {importProgress.loaded}/{importProgress.total}
            </span>
          </>
        ) : (
          <span className="truncate text-[11px]">{importProgress.message}</span>
        )}
        {onCancel && (
          <button
            type="button"
            className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shrink-0"
            onClick={onCancel}
            title="Cancel import"
            aria-label="Cancel import"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (status) {
    return (
      <div className="flex min-w-0 max-w-[260px] items-center gap-1.5 truncate text-muted-foreground text-xs" title={status}>
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <span className="truncate">{status}</span>
        {onCancel && (
          <button
            type="button"
            className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shrink-0"
            onClick={onCancel}
            title="Cancel"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return null;
}

function EmptyState({
  onFiles,
  onFolder,
  onRootFolder,
  disabled,
}: {
  onFiles: () => void;
  onFolder: () => void;
  onRootFolder: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 grid place-items-center overflow-auto p-4">
      <div className="w-full max-w-md text-center border border-dashed border-border rounded-lg p-6 bg-card/40">
        <div className="mx-auto mb-3 h-10 w-10 rounded-md bg-primary/15 text-primary grid place-items-center">
          <Upload className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold">Drop audio files or folders here</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">MP3 · M4A · AAC · FLAC · WAV · Ogg · Opus · AIFF · WMA · APE · WavPack · MPC · TTA · Speex</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything stays in your browser. No uploads, no accounts.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button className="h-8 text-xs" onClick={onFiles} disabled={disabled}>
            <Upload className="mr-1.5 h-4 w-4" />
            Files
          </Button>
          <Button variant="outline" className="h-8 text-xs" onClick={onFolder} disabled={disabled}>
            <FolderOpen className="mr-1.5 h-4 w-4" />
            Folder
          </Button>
          <Button variant="outline" className="h-8 text-xs" onClick={onRootFolder} disabled={disabled}>
            <FolderTree className="mr-1.5 h-4 w-4" />
            Root folder
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-left text-xs text-muted-foreground">
          <Feature icon={FileText} title="Tag Converter" desc="Format patterns & filename tags" />
          <Feature icon={Wand2} title="Bulk Edit" desc="Find/replace, case & text tools" />
          <Feature icon={FolderOpen} title="Folder Rename" desc="Batch rename music folders" />
          <Feature icon={ImageIcon} title="Cover Art" desc="View & update album covers" />
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="flex items-center gap-1.5 text-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-medium">{title}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>
    </div>
  );
}

const defaultWidths: Record<string, number> = {
  track: 60,
  folder: 180,
  filename: 220,
  path: 250,
  title: 200,
  album: 180,
  artist: 160,
  albumArtist: 160,
  composer: 140,
  year: 70,
  tag: 120,
  genre: 140,
  discnumber: 70,
  comment: 220,
  bpm: 65,
  cover: 65,
  codec: 80,
  bitrate: 80,
  frequency: 90,
  length: 70,
  vbr: 65,
  mode: 75,
  size: 80,
  modified: 150,
};
export function FileTable({
  files,
  selected,
  filter,
  status,
  importProgress,
  onCancelImport,
  onToggle,
  onSelectAll,
  onEdit,
  onEditFolder,
  onEditFilename,
  onRemoveSelected,
  onRemoveAll,
  preview,
  onPreview,
  onDelete,
  actionsDisabled,
  previewPlayer,
  activePreviewTrack,
  onRevealPreview,
  allTracks,
}: {
  files: Mp3File[];
  selected: Set<string>;
  filter: string;
  status?: string | null;
  importProgress?: ImportProgress | null;
  onCancelImport?: () => void;
  onToggle: (id: string, additive: boolean) => void;
  onSelectAll: (selected: Set<string>) => void;
  onEdit: (id: string, key: TagKey, value: string) => void;
  onEditFolder: (id: string, value: string) => void;
  onEditFilename: (id: string, value: string) => void;
  onRemoveSelected: () => void;
  onRemoveAll: () => void;
  preview: PreviewState;
  onPreview: (file: Mp3File) => void;
  onDelete: (ids: string[]) => Promise<string[]>;
  actionsDisabled: boolean;
  previewPlayer: AudioPreview | null;
  activePreviewTrack?: Mp3File;
  onRevealPreview?: (id: string) => void;
  allTracks?: Mp3File[];
}) {
  const [visibleColumns, setVisibleColumns] = useState<Set<TableColumnKey>>(
    () => new Set(DEFAULT_VISIBLE_COLUMNS),
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  
  // Column reordering order state
  const [columnOrder, setColumnOrder] = useState<TableColumnKey[]>(() =>
    [...DEFAULT_TABLE_SETTINGS.columnOrder],
  );

  // Drag and drop states
  const [draggedCol, setDraggedCol] = useState<TableColumnKey | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TableColumnKey | null>(null);
  const [resizingCol, setResizingCol] = useState<TableColumnKey | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragStart(e: React.DragEvent, key: TableColumnKey) {
    if (key === "cover") {
      e.preventDefault();
      return;
    }
    setIsDragging(true);
    setDraggedCol(key);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(key));
  }

  function handleDragOver(e: React.DragEvent, targetKey: TableColumnKey) {
    if (targetKey === "cover" || draggedCol === targetKey) return;
    e.preventDefault();
    setDragOverCol(targetKey);
  }

  function handleDragLeave() {
    setDragOverCol(null);
  }

  function handleDrop(e: React.DragEvent, targetKey: TableColumnKey) {
    e.preventDefault();
    setDragOverCol(null);
    if (!draggedCol || draggedCol === targetKey || targetKey === "cover") return;

    setColumnOrder((prev) => {
      const next = [...prev];
      const draggedIdx = next.indexOf(draggedCol);
      const targetIdx = next.indexOf(targetKey);
      if (draggedIdx !== -1 && targetIdx !== -1) {
        next.splice(draggedIdx, 1);
        next.splice(targetIdx, 0, draggedCol);
      }
      return next;
    });
  }

  function handleDragEnd() {
    setDraggedCol(null);
    setDragOverCol(null);
    // Simple delay to make sure we don't trigger click sort action
    setTimeout(() => setIsDragging(false), 50);
  }

  // Sorting states
  const [sortKey, setSortKey] = useState<TableColumnKey | null>("album");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Container ref to directly set CSS variables on DOM during resize
  const containerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const revealRowRef = useRef<HTMLTableRowElement>(null);
  const [revealId, setRevealId] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(1000);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsWarningRef = useRef(false);
  // Load after hydration; never overwrite saved preferences with initial defaults.
  useEffect(() => {
    const saved = loadTableSettings(DEFAULT_TABLE_SETTINGS);
    setColumnOrder(saved.columnOrder);
    setVisibleColumns(new Set(saved.visibleColumns));
    setColumnWidths(saved.columnWidths);
    setSortKey(saved.sortKey);
    setSortOrder(saved.sortOrder);
    setPageSize(saved.pageSize);
    setSettingsLoaded(true);
  }, []);
  useEffect(() => {
    if (!settingsLoaded) return;
    const saved = saveTableSettings({ columnOrder, visibleColumns: [...visibleColumns], columnWidths, sortKey, sortOrder, pageSize });
    if (!saved && !settingsWarningRef.current) {
      settingsWarningRef.current = true;
      toast.error("Table preferences cannot be saved: browser storage is unavailable.");
    }
  }, [settingsLoaded, columnOrder, visibleColumns, columnWidths, sortKey, sortOrder, pageSize]);
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Reset current page when the files count, search filter, or sort key/order changes
  const pageResetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([files.length, filter, sortKey, sortOrder]);
    if (pageResetKeyRef.current === key) return;
    pageResetKeyRef.current = key;
    // Clearing a search to reveal playback must not override its requested page.
    if (!revealId) setCurrentPage(1);
  }, [files.length, filter, sortKey, sortOrder, revealId]);

  // Compute sorted files list
  const sortedFiles = useMemo(() => {
    if (!sortKey) return files;

    const col = TABLE_COLUMNS.find((c) => c.key === sortKey);
    if (!col) return files;

    const copy = [...files];
    copy.sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      if (col.kind === "folder") {
        valA = a.editedFolderName || "";
        valB = b.editedFolderName || "";
      } else if (col.kind === "filename") {
        valA = a.file.name || "";
        valB = b.file.name || "";
      } else if (col.kind === "path") {
        valA = a.meta.path || "";
        valB = b.meta.path || "";
      } else if (col.kind === "tag") {
        valA = a.tags[col.key as TagKey] || "";
        valB = b.tags[col.key as TagKey] || "";
      } else if (col.kind === "meta") {
        valA = a.meta[col.key as MetaKey] ?? "";
        valB = b.meta[col.key as MetaKey] ?? "";
      }

      // Check if both are numeric (either numbers or strings representing numbers)
      const isNumA = typeof valA === "number" || (valA !== "" && !isNaN(Number(valA)));
      const isNumB = typeof valB === "number" || (valB !== "" && !isNaN(Number(valB)));

      let comparison = 0;

      if (isNumA && isNumB) {
        comparison = Number(valA) - Number(valB);
      } else {
        // Fallback for special track/discnumber formats like "01/12"
        if (col.key === "track" || col.key === "discnumber") {
          const numA = parseInt(String(valA).split("/")[0], 10) || 0;
          const numB = parseInt(String(valB).split("/")[0], 10) || 0;
          comparison = numA - numB;
          if (comparison === 0) {
            comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
          }
        } else {
          comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        }
      }

      if (comparison === 0 && sortKey === "album") {
        const number = (value: string) => parseInt(value.split("/")[0], 10) || 0;
        return number(a.tags.discnumber) - number(b.tags.discnumber) || number(a.tags.track) - number(b.tags.track) || a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: "base" });
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return copy;
  }, [files, sortKey, sortOrder]);

  // Compute total pages based on current files length
  const totalPages = Math.max(1, Math.ceil(files.length / pageSize));
  
  // Clamp current page so it is always within valid page range (prevent out of bounds)
  const activePage = Math.min(currentPage, totalPages);

  // Sync active page back to currentPage state if it was clamped
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Get current page slice of sorted files
  const pageFiles = useMemo(() => {
    const start = (activePage - 1) * pageSize;
    return sortedFiles.slice(start, start + pageSize);
  }, [sortedFiles, activePage, pageSize]);

  // A footer action reveals once, rather than forcing scroll on every playback tick.
  useLayoutEffect(() => {
    if (!revealId) return;
    const page = previewPage(sortedFiles, revealId, pageSize);
    if (page === null) return; // Parent may be clearing a filter hiding this song.
    if (activePage !== page) {
      setCurrentPage(page);
      return;
    }
    const scroller = tableScrollRef.current;
    const row = revealRowRef.current;
    if (!scroller || !row) return;
    const viewport = scroller.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const headerHeight = scroller.querySelector("thead")?.getBoundingClientRect().height || 0;
    scroller.scrollTop = previewScrollTop(
      scroller.scrollTop, viewport.top, scroller.clientHeight, headerHeight, bounds.top, bounds.bottom,
    );
    setRevealId(null);
  }, [revealId, sortedFiles, activePage, pageSize]);

  function previewFromFooter(file: Mp3File) {
    if (preview.id !== file.id || (!preview.playing && !preview.loading)) {
      setRevealId(file.id);
      onRevealPreview?.(file.id);
    }
    onPreview(file);
  }

  const deleteInFlightRef = useRef(false);
  async function deleteAndContinue(ids: string[]) {
    if (actionsDisabled || deleteInFlightRef.current || !ids.length) return;
    deleteInFlightRef.current = true;
    const activeId = previewPlayer?.state.id || preview.id;
    const order = sortedFiles.some((file) => file.id === activeId) ? sortedFiles : allTracks || sortedFiles;
    try {
      const deleted = new Set(await onDelete(ids));
      const next = nextAfterDeletion(order, activeId, deleted);
      // A user-initiated preview change must not be interrupted by deletion completion.
      const currentId = previewPlayer?.state.id;
      if (next && (!currentId || deleted.has(currentId))) previewFromFooter(next);
    } finally {
      deleteInFlightRef.current = false;
    }
  }

  function handleSort(key: TableColumnKey) {
    if (isDragging || key === "cover") return;

    if (sortKey === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  }

  // Check if all files on the current page are selected
  const allPageSelected = useMemo(() => {
    return pageFiles.length > 0 && pageFiles.every((f) => selected.has(f.id));
  }, [pageFiles, selected]);

  // Check if all filtered files are selected
  const allFilteredSelected = useMemo(() => {
    return files.length > 0 && files.every((f) => selected.has(f.id));
  }, [files, selected]);

  // Handle click on the header checkbox (toggles selection of files on the current page)
  function handleHeaderCheckboxChange(checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      for (const f of pageFiles) {
        next.add(f.id);
      }
    } else {
      for (const f of pageFiles) {
        next.delete(f.id);
      }
    }
    onSelectAll(next);
  }

  // Gmail-style banner action: select all files matching the filter
  function handleSelectAllFiltered() {
    const next = new Set(selected);
    for (const f of files) {
      next.add(f.id);
    }
    onSelectAll(next);
  }

  // Gmail-style banner action: clear entire selection
  function handleClearSelection() {
    lastClickedIdRef.current = null;
    onSelectAll(new Set());
  }

  const lastClickedIdRef = useRef<string | null>(null);

  // Range and multi-selection handler for row clicks and checkbox clicks
  function handleRowSelection(
    id: string,
    options: { isCheckbox: boolean; shiftKey: boolean; ctrlKey: boolean },
  ) {
    const { isCheckbox, shiftKey, ctrlKey } = options;

    if (shiftKey && lastClickedIdRef.current) {
      const anchorId = lastClickedIdRef.current;
      const fromIdx = pageFiles.findIndex((f) => f.id === anchorId);
      const toIdx = pageFiles.findIndex((f) => f.id === id);

      if (fromIdx !== -1 && toIdx !== -1) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const next = new Set(selected);
        for (let i = start; i <= end; i++) {
          next.add(pageFiles[i].id);
        }
        onSelectAll(next);
        return;
      }
    }

    lastClickedIdRef.current = id;

    if (isCheckbox) {
      const next = new Set(selected);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectAll(next);
    } else {
      if (ctrlKey) {
        const next = new Set(selected);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        onSelectAll(next);
      } else {
        onSelectAll(new Set([id]));
      }
    }
  }

  function openRowMenu(e: React.MouseEvent<HTMLTableRowElement>, file: Mp3File) {
    e.preventDefault();
    e.stopPropagation();
    lastClickedIdRef.current = file.id;
    if (!selected.has(file.id)) {
      onSelectAll(new Set([file.id]));
    }
    setRowMenu({
      id: file.id,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 260),
    });
  }

  useEffect(() => {
    if (!rowMenu) return;
    const close = () => setRowMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rowMenu]);

  // Direct DOM writes make column resizing feel crisp and attached to the pointer.
  function handleResizeStart(key: TableColumnKey, startEvent: React.MouseEvent) {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const startX = startEvent.clientX;
    const startWidth = columnWidths[key] || defaultWidths[key] || 150;
    let lastWidth = startWidth;
    setResizingCol(key);

    function handleMouseMove(moveEvent: MouseEvent) {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(40, startWidth + deltaX);
      lastWidth = newWidth;
      containerRef.current?.style.setProperty(`--col-width-${key}`, `${newWidth}px`);
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      setResizingCol(null);
      // Persist the final width to React state
      setColumnWidths((prev) => ({
        ...prev,
        [key]: lastWidth,
      }));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function toggleColumn(key: TableColumnKey) {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const visible = useMemo(() => {
    return columnOrder
      .map((key) => TABLE_COLUMNS.find((c) => c.key === key)!)
      .filter((c) => c && visibleColumns.has(c.key));
  }, [columnOrder, visibleColumns]);

  // Initialize CSS variables for column widths on the container
  const containerStyle = useMemo(() => {
    const vars: Record<string, string> = {};
    TABLE_COLUMNS.forEach((col) => {
      const w = columnWidths[col.key] || defaultWidths[col.key] || 150;
      vars[`--col-width-${col.key}`] = `${w}px`;
    });
    return vars as React.CSSProperties;
  }, [columnWidths]);

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className="flex-1 flex flex-col overflow-hidden"
    >
      {/* Gmail-style select-all banner */}
      {allPageSelected && files.length > pageSize && (
        <div className="bg-primary/10 border-b border-border/80 px-4 py-1.5 text-xs text-center flex items-center justify-center gap-1.5">
          {!allFilteredSelected ? (
            <>
              <span className="text-muted-foreground">
                All <strong className="text-foreground">{pageFiles.length}</strong> tracks on this page are selected.
              </span>
              <Button
                variant="link"
                className="h-auto p-0 font-semibold text-primary hover:underline text-xs"
                onClick={handleSelectAllFiltered}
              >
                Select all {files.length} tracks in this list
              </Button>
            </>
          ) : (
            <>
              <span className="text-muted-foreground">
                All <strong className="text-foreground">{files.length}</strong> tracks in this list are selected.
              </span>
              <Button
                variant="link"
                className="h-auto p-0 font-semibold text-primary hover:underline text-xs"
                onClick={handleClearSelection}
              >
                Clear selection
              </Button>
            </>
          )}
        </div>
      )}

      {/* Table container */}
      <div ref={tableScrollRef} data-testid="song-table-scroll" className="flex-1 overflow-auto bg-white text-slate-950 dark:bg-background dark:text-foreground">
        <table className="w-full border-collapse table-fixed bg-white text-xs text-slate-950 dark:bg-background dark:text-foreground">
          <thead className="sticky top-0 z-10 border-b border-slate-300 bg-[#f3f4f6] text-[11px] leading-none text-slate-700 dark:border-border dark:bg-secondary/80 dark:text-muted-foreground">
            <tr className="h-[19px] border-b border-slate-300 bg-[#f3f4f6] dark:border-border dark:bg-secondary/30">
              <th style={{ width: 36, minWidth: 36, maxWidth: 36 }} className="h-[19px] align-middle px-2 py-0 text-left">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={(e) => handleHeaderCheckboxChange(e.currentTarget.checked)}
                  aria-label="Select page"
                  className="h-[11px] w-[11px] align-middle accent-primary"
                />
              </th>
              <th style={{ width: 160, minWidth: 160, maxWidth: 160 }} className="px-2 py-0 text-left font-semibold">
                Actions
              </th>
              {visible.map((col) => {
                const colStyle = {
                  width: `var(--col-width-${col.key})`,
                  minWidth: `var(--col-width-${col.key})`,
                  maxWidth: `var(--col-width-${col.key})`,
                };
                const isOver = dragOverCol === col.key;
                const isDragged = draggedCol === col.key;
                const isResizing = resizingCol === col.key;
                return (
                  <th
                    key={col.key}
                    aria-sort={sortKey === col.key ? sortOrder === "asc" ? "ascending" : "descending" : "none"}
                    style={colStyle}
                    draggable={col.key !== "cover"}
                    onDragStart={(e) => handleDragStart(e, col.key)}
                    onDragOver={(e) => handleDragOver(e, col.key)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.key)}
                    onDragEnd={handleDragEnd}
                    className={`relative group h-[19px] select-none py-0 text-left font-semibold text-slate-700 dark:text-foreground/80 ${
                      col.key !== "cover" ? "cursor-grab active:cursor-grabbing hover:bg-slate-200/70 dark:hover:bg-accent/30" : ""
                    } ${
                      isOver ? "bg-slate-200/70 px-2 dark:bg-accent/30" : "px-2"
                    } ${
                      isDragged ? "bg-slate-200 opacity-40 dark:bg-accent/20" : ""
                    } ${col.className ?? ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex h-[18px] items-center gap-1 truncate pr-3" title={col.label}>
                      <span className="truncate">{col.label}</span>
                      {col.key !== "cover" && (
                        <span
                          className={`shrink-0 transition-colors ${
                            sortKey === col.key ? "text-primary opacity-100" : "text-slate-400 group-hover:text-slate-700 dark:text-muted-foreground/60 dark:group-hover:text-foreground/80"
                          }`}
                        >
                          {sortKey === col.key ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Invisible resize handle keeps resizing available without header separator lines. */}
                    <div
                      onMouseDown={(e) => handleResizeStart(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="group/resize absolute right-0 top-0 bottom-0 z-20 w-3 -mr-1.5 cursor-col-resize"
                    >
                      <span
                        className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-500 dark:bg-primary ${
                          isResizing ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100"
                        }`}
                      />
                    </div>
                  </th>
                );
              })}
              <th style={{ width: 32, minWidth: 32, maxWidth: 32 }} className="h-[19px] px-1 py-0 text-right">
                <ColumnMenu
                  columns={TABLE_COLUMNS}
                  visibleColumns={visibleColumns}
                  onToggle={toggleColumn}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {pageFiles.map((f) => {
              const isSel = selected.has(f.id);
              return (
                <tr
                  key={f.id}
                  ref={f.id === revealId ? revealRowRef : undefined}
                  data-selected={isSel}
                  data-preview-active={preview.id === f.id}
                  aria-current={preview.id === f.id ? "true" : undefined}
                  className="h-6 border-b border-slate-200 bg-white hover:bg-slate-50 data-[selected=true]:bg-blue-50 data-[selected=true]:hover:bg-blue-100 dark:border-border/60 dark:bg-transparent dark:hover:bg-accent/40 dark:data-[selected=true]:bg-primary/10 dark:data-[selected=true]:hover:bg-primary/15 data-[preview-active=true]:bg-amber-50! data-[preview-active=true]:hover:bg-amber-100! dark:data-[preview-active=true]:bg-primary/15! dark:data-[preview-active=true]:hover:bg-primary/20!"
                  onClick={(e) =>
                    handleRowSelection(f.id, {
                      isCheckbox: false,
                      shiftKey: e.shiftKey,
                      ctrlKey: e.metaKey || e.ctrlKey,
                    })
                  }
                  onContextMenu={(e) => openRowMenu(e, f)}
                >
                  <td style={{ width: 36, minWidth: 36, maxWidth: 36 }} className="align-middle px-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRowSelection(f.id, {
                          isCheckbox: true,
                          shiftKey: e.shiftKey,
                          ctrlKey: e.metaKey || e.ctrlKey,
                        });
                      }}
                      onChange={() => {}}
                      aria-label="Select"
                      className="h-3 w-3 align-middle accent-primary cursor-pointer"
                    />
                  </td>
                  <td style={{ width: 160, minWidth: 160, maxWidth: 160 }} className="px-2 py-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`grid h-5 w-6 place-items-center rounded-[4px] hover:bg-slate-200 dark:hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-40 ${preview.id === f.id ? "text-primary" : "text-slate-600 dark:text-muted-foreground"}`}
                        disabled={actionsDisabled}
                        aria-label={`${preview.id === f.id && (preview.playing || preview.loading) ? "Pause" : "Play"} ${f.file.name}`}
                        title={preview.id === f.id && preview.loading ? "Cancel loading preview" : preview.id === f.id && preview.playing ? "Pause preview" : "Play original song preview"}
                        onClick={() => onPreview(f)}
                      >
                        {preview.id === f.id && preview.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : preview.id === f.id && preview.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <RowSeekControl player={previewPlayer} file={f} active={preview.id === f.id} disabled={actionsDisabled} />
                      <button
                        type="button"
                        className="grid h-5 w-6 place-items-center rounded-[4px] text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-muted-foreground dark:hover:bg-destructive/10 dark:hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive disabled:opacity-40"
                        disabled={actionsDisabled}
                        aria-label={`Delete ${f.file.name} from disk`}
                        title="Permanently delete original song file immediately (no undo)"
                        onClick={() => void deleteAndContinue([f.id])}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                  {visible.map((col) => (
                    <TableCell
                      key={col.key}
                      file={f}
                      col={col}
                      onEdit={onEdit}
                      onEditFolder={onEditFolder}
                      onEditFilename={onEditFilename}
                    />
                  ))}
                  <td style={{ width: 32, minWidth: 32, maxWidth: 32 }} className="px-1 py-0.5" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rowMenu && (
        <div
          className="fixed z-[70] w-52 rounded-sm border border-border bg-background py-1 text-xs text-foreground shadow-sm"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <ContextMenuItem
            onSelect={() => {
              onSelectAll(new Set([rowMenu.id]));
              setRowMenu(null);
            }}
          >
            Select only this row
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selected.has(rowMenu.id)}
            onSelect={() => {
              const next = new Set(selected);
              next.add(rowMenu.id);
              onSelectAll(next);
              setRowMenu(null);
            }}
          >
            Add row to selection
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selected.has(rowMenu.id)}
            onSelect={() => {
              const next = new Set(selected);
              next.delete(rowMenu.id);
              onSelectAll(next);
              setRowMenu(null);
            }}
          >
            Remove row from selection
          </ContextMenuItem>
          <div className="my-1 border-t border-border" />
          <ContextMenuItem
            onSelect={() => {
              const next = new Set(selected);
              for (const f of pageFiles) next.add(f.id);
              onSelectAll(next);
              setRowMenu(null);
            }}
          >
            Select page
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              handleSelectAllFiltered();
              setRowMenu(null);
            }}
          >
            Select all filtered
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selected.size}
            onSelect={() => {
              handleClearSelection();
              setRowMenu(null);
            }}
          >
            Clear selection
          </ContextMenuItem>
          <div className="my-1 border-t border-border" />
          <ContextMenuItem
            danger
            disabled={!selected.size}
            onSelect={() => {
              onRemoveSelected();
              setRowMenu(null);
            }}
          >
            Remove selected
          </ContextMenuItem>
          <ContextMenuItem
            danger
            onSelect={() => {
              onRemoveAll();
              setRowMenu(null);
            }}
          >
            Remove all loaded
          </ContextMenuItem>
        </div>
      )}

      <PreviewTransport player={previewPlayer} preview={preview} tracks={sortedFiles} activeTrack={activePreviewTrack || files.find((file) => file.id === preview.id)} selected={selected} disabled={actionsDisabled} onPreview={previewFromFooter} onDelete={(id) => void deleteAndContinue([id])} onDeleteSelected={() => void deleteAndContinue([...selected])} />
      {/* Pagination Footer */}
      <div className="relative border-t border-border px-3 py-1.5 flex items-center justify-between text-xs bg-sidebar/40 backdrop-blur select-none h-11 shrink-0 gap-3">
        {/* Left: Track counters and Selection */}
        <div className="flex items-center gap-1.5 text-muted-foreground shrink-0 whitespace-nowrap">
          <span>Showing</span>
          <span className="font-semibold text-foreground">
            {files.length === 0 ? 0 : (activePage - 1) * pageSize + 1}
          </span>
          <span>to</span>
          <span className="font-semibold text-foreground">
            {Math.min(activePage * pageSize, files.length)}
          </span>
          <span>of</span>
          <span className="font-semibold text-foreground">{files.length}</span>
          <span>tracks</span>
          {selected.size > 0 && (
            <>
              <span className="mx-1 text-border">·</span>
              <span className="font-medium text-foreground">
                {selected.size} selected
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-[11px] border-border/80 bg-background/60 hover:bg-accent hover:text-foreground ml-0.5"
                onClick={handleClearSelection}
                title="Clear selection"
              >
                Clear selection
              </Button>
            </>
          )}
        </div>

        {/* Center: Progress / Status or Pagination */}
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden px-2">
          <ProgressOrStatus
            importProgress={importProgress}
            status={status}
            onCancel={onCancelImport}
          />
          {!importProgress && !status && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage(1)}
                disabled={activePage === 1}
                title="First Page"
              >
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={activePage === 1}
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              
              <span className="mx-1.5 text-muted-foreground whitespace-nowrap">
                Page <span className="font-medium text-foreground">{activePage}</span> of{" "}
                <span className="font-medium text-foreground">{totalPages}</span>
              </span>

              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={activePage === totalPages}
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage(totalPages)}
                disabled={activePage === totalPages}
                title="Last Page"
              >
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Right: Compact pagination (when loading) + Page size dropdown */}
        <div className="flex items-center justify-end gap-2 shrink-0 whitespace-nowrap">
          {(importProgress || status) && totalPages > 1 && (
            <div className="hidden lg:flex items-center gap-1 mr-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={activePage === 1}
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="mx-1 text-muted-foreground text-[11px]">
                {activePage}/{totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded border-border bg-background"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={activePage === totalPages}
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <span className="text-muted-foreground">Show:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="h-7 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-accent/50 transition-colors"
          >
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={250}>250 per page</option>
            <option value={500}>500 per page</option>
            <option value={1000}>1000 per page</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ToolbarMenu({
  label,
  icon: Icon,
  disabled,
  className = "",
  items,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  className?: string;
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={"relative " + className}>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="mr-1.5 h-4 w-4" />
        {label}
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[70] mt-1 w-48 rounded-sm border border-border bg-background py-1 text-xs text-foreground shadow-sm"
        >
          {items.map((item) => (
            <ContextMenuItem
              key={item.label}
              disabled={item.disabled}
              onSelect={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </ContextMenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadedFilesMenu({
  total,
  selected,
  onRemoveSelected,
  onRemoveAll,
}: {
  total: number;
  selected: number;
  onRemoveSelected: () => void;
  onRemoveAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <Button
        size="sm"
        variant="outline"
        disabled={!total}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Trash2 className="mr-1.5 h-4 w-4" />
        Remove
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[70] mt-1 w-52 rounded-sm border border-border bg-background py-1 text-xs text-foreground shadow-sm"
        >
          <ContextMenuItem
            danger
            disabled={!selected}
            onSelect={() => {
              onRemoveSelected();
              setOpen(false);
            }}
          >
            Remove selected ({selected})
          </ContextMenuItem>
          <ContextMenuItem
            danger
            onSelect={() => {
              onRemoveAll();
              setOpen(false);
            }}
          >
            Remove all loaded ({total})
          </ContextMenuItem>
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
            Source files are not deleted
          </div>
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({
  children,
  disabled,
  danger,
  onSelect,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`block h-7 w-full px-3 text-left text-xs disabled:cursor-not-allowed disabled:opacity-45 ${
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-accent hover:text-accent-foreground"
      }`}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function ColumnMenu({
  columns,
  visibleColumns,
  onToggle,
}: {
  columns: TableColumn[];
  visibleColumns: Set<TableColumnKey>;
  onToggle: (key: TableColumnKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-[18px] w-6 text-muted-foreground hover:text-foreground"
        aria-label="Toggle columns"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <MoreVertical className="h-3 w-3" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-48 overflow-y-auto rounded-sm border border-border bg-popover p-1 text-left text-[11px] text-popover-foreground shadow-none">
          <div className="px-1.5 py-1 font-semibold text-popover-foreground">Customize...</div>
          <div className="my-0.5 border-t border-border/60" />
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-0.5 leading-5 hover:bg-accent"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={visibleColumns.has(col.key)}
                onChange={() => onToggle(col.key)}
                className="h-3 w-3 accent-primary"
              />
              <span className="truncate">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TableCell({
  file,
  col,
  onEdit,
  onEditFolder,
  onEditFilename,
}: {
  file: Mp3File;
  col: TableColumn;
  onEdit: (id: string, key: TagKey, value: string) => void;
  onEditFolder: (id: string, value: string) => void;
  onEditFilename: (id: string, value: string) => void;
}) {
  const colStyle = {
    width: `var(--col-width-${col.key})`,
    minWidth: `var(--col-width-${col.key})`,
    maxWidth: `var(--col-width-${col.key})`,
  };

  if (col.kind === "folder") {
    return (
      <TdCell
        value={file.editedFolderName}
        onChange={(v) => onEditFolder(file.id, v)}
        style={colStyle}
      />
    );
  }

  if (col.kind === "filename") {
    return (
      <TdCell
        value={directSaveFilename(file)}
        onChange={(v) => onEditFilename(file.id, v)}
        style={colStyle}
        dirty={file.dirty}
      />
    );
  }

  if (col.kind === "tag") {
    return (
      <TdCell
        value={file.tags[col.key as TagKey]}
        onChange={(v) => onEdit(file.id, col.key as TagKey, v)}
        style={colStyle}
      />
    );
  }

  if (col.kind === "cover") {
    return (
      <td style={colStyle} className="px-2 py-0.5">
        {file.tags.cover?.dataUrl ? (
          <img
            src={file.tags.cover.dataUrl}
            alt=""
            className="h-5 w-5 rounded object-cover"
          />
        ) : null}
      </td>
    );
  }

  const readOnly =
    col.kind === "path"
      ? file.meta.path
      : file.meta[col.key as MetaKey];

  return (
    <td
      style={colStyle}
      className="truncate px-2 py-0.5 text-slate-700 dark:text-muted-foreground"
      title={readOnly}
    >
      {readOnly}
    </td>
  );
}

function EditorPanel({
  tags,
  count,
  selectedFiles,
  onChange,
  onCoverPick,
  onCoverDelete,
  onCollapse,
}: {
  tags: Mp3Tags;
  count: number;
  selectedFiles: Mp3File[];
  onChange: (key: TagKey, value: string) => void;
  onCoverPick: (file: File) => void;
  onCoverDelete: () => void;
  onCollapse: () => void;
}) {
  const coverInput = useRef<HTMLInputElement>(null);
  const [showCoverArt, setShowCoverArt] = useState(true);
  // Unique non-empty values per field across selected files → dropdown options.
  const fieldOptions = useMemo(() => {
    const map: Partial<Record<TagKey, string[]>> = {};
    for (const f of FIELDS) {
      const set = new Set<string>();
      for (const m of selectedFiles) {
        const v = m.tags[f.key];
        if (typeof v === "string" && v.trim()) set.add(v);
      }
      map[f.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [selectedFiles]);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Editor
          </p>
          <p className="mt-0.5 text-xs font-medium">
            {count === 0
              ? "No selection"
              : count === 1
                ? "Editing 1 track"
                : `Editing ${count} tracks`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label={showCoverArt ? "Hide cover art" : "Show cover art"}
            title={showCoverArt ? "Hide cover art" : "Show cover art"}
            aria-expanded={showCoverArt}
            onClick={() => setShowCoverArt((value) => !value)}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showCoverArt ? "" : "-rotate-90"}`}
            />
          </button>
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label="Hide editor"
            title="Hide editor"
            onClick={onCollapse}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showCoverArt && (
        <div className="shrink-0 px-3 py-2">
          <div
            className="group relative grid aspect-square place-items-center overflow-hidden rounded-md border border-border bg-background/40"
          >
            {tags.cover?.dataUrl ? (
              <img
src={tags.cover.dataUrl}
                alt="Embedded cover art"
                title="Cover art embedded in the selected song (or your unsaved artwork edit)"
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="text-center text-xs text-muted-foreground">
                <ImageIcon className="mx-auto mb-1 h-6 w-6 opacity-50" />
                No cover art
              </div>
            )}
            {count > 0 && (
              <div className="absolute inset-x-0 bottom-0 flex gap-1 bg-background/75 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 flex-1 px-2 text-[11px]"
                  onClick={() => coverInput.current?.click()}
                  title="Upload cover art"
                >
                  <Upload className="mr-1 h-3 w-3" />
                  Upload
                </Button>
                {tags.cover && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={onCoverDelete}
                    title="Delete cover art"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onCoverPick(e.target.files[0])}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto px-2.5 pb-2.5 space-y-1">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-px">
            <Label className="text-[11px] leading-none text-foreground">{f.label}</Label>
            <TagFieldCombo
              disabled={count === 0}
              value={tags[f.key]}
              options={fieldOptions[f.key] || []}
              onChange={(v) => onChange(f.key, v)}
              multiline={f.key === "comment"}
              fieldLabel={f.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ==== helpers ====

function renamedFilename(m: Mp3File, pattern: string): string {
  const orig = m.file.name;
  const dot = orig.lastIndexOf(".");
  const ext = dot > 0 ? orig.slice(dot) : ".mp3";
  const base = dot > 0 ? orig.slice(0, dot) : orig;
  if (m.renamedBase !== undefined) return m.renamedBase + ext;
  return renameByPattern(pattern, m.tags, base) + ext;
}

function directSaveFilename(m: Mp3File): string {
  if (m.renamedBase === undefined) return m.file.name;
  const dot = m.file.name.lastIndexOf(".");
  const extension = dot > 0 ? m.file.name.slice(dot) : "";
  return m.renamedBase + extension;
}

function replacePathFilename(path: string, filename: string): string {
  if (!path) return filename;
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(0, slash + 1) + filename : filename;
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function uniqueName(zip: JSZip, name: string): string {
  if (!zip.file(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (zip.file(`${base} (${i})${ext}`)) i++;
  return `${base} (${i})${ext}`;
}
