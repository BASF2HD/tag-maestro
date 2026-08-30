import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { Toaster, toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Music4,
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
  X,
} from "@/components/icons";
import {
  readMp3,
  writeTagsToBlob,
  dataUrlToCover,
  renameByPattern,
  emptyTags,
  SUPPORTED_EXTS,
  SUPPORTED_ACCEPT,
  IMAGE_EXTS,
  extractFolderName,
  type Mp3File,
  type Mp3Tags,
  type FileMeta,
} from "@/lib/mp3";
import { FolderRenameDialog } from "@/components/FolderRenameDialog";
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

const MULTI = "<keep>";

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
): Promise<FolderFileEntry[]> {
  const entries: FolderFileEntry[] = [];
  const pauseForPaint = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  let lastPaintTime = Date.now();

  async function walk(handle: FileSystemDirectoryHandle, path: string) {
    if (shouldCancel?.()) return;
    for await (const [name, child] of (handle as any).entries()) {
      if (shouldCancel?.()) return;
      const relativePath = path ? `${path}/${name}` : name;
      if (child.kind === "directory") {
        onProgress?.(entries.length, relativePath);
        if (Date.now() - lastPaintTime > 150) {
          lastPaintTime = Date.now();
          await pauseForPaint();
        }
        await walk(child as FileSystemDirectoryHandle, relativePath);
      } else if (child.kind === "file") {
        const fileHandle = child as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        entries.push({ file, relativePath, handle: fileHandle, parentHandle: handle });
        if (entries.length % 50 === 0 || Date.now() - lastPaintTime > 150) {
          lastPaintTime = Date.now();
          onProgress?.(entries.length, path);
          await pauseForPaint();
        }
      }
    }
  }

  await walk(directoryHandle, directoryHandle.name);
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

function TagMaestro() {
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [pattern] = useState("%artist% - %title%");
  const [filter, setFilter] = useState("");
  const [folderRenameOpen, setFolderRenameOpen] = useState(false);
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

  useEffect(() => {
    const first = selectedFiles[0];
    if (!first || first.tags.cover || coverProbeIds.current.has(first.id)) return;

    coverProbeIds.current.add(first.id);
    let cancelled = false;
    void readMp3(
      first.file,
      first.meta.path || first.file.name,
      true,
      true,
      first.sourceHandle,
      first.sourceDirectoryHandle,
    ).then((loaded) => {
      const cover = loaded.tags.cover;
      if (cancelled || !cover) return;
      setFiles((prev) =>
        prev.map((f) => {
          const sameAlbumGroup =
            Boolean(first.folderPath || first.tags.album) &&
            f.folderPath === first.folderPath &&
            f.tags.album === first.tags.album;
          const sameTrack = f.id === first.id;
          return !f.tags.cover && (sameTrack || sameAlbumGroup)
            ? { ...f, tags: { ...f.tags, cover }, original: { ...f.original, cover } }
            : f;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFiles]);

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
      toast.error("No supported audio files (MP3, M4A, FLAC, WAV)");
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
            true,
            entry.handle,
            entry.parentHandle,
          )),
          librarySourceId: options.sourceId,
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
    const coverByFolder = new Map<string, File>();

    // Scan once to avoid duplicating very large folder selections in memory.
    for (let i = 0; i < pickedCount; i++) {
      const entry = asFolderEntry(source[i]);
      const f = entry.file;
      const n = f.name.toLowerCase();
      if (SUPPORTED_EXTS.some((ext) => n.endsWith(ext))) {
        audioFiles.push(entry);
      } else if (IMAGE_EXTS.some((ext) => n.endsWith(ext))) {
        const rp = entry.relativePath;
        const parts = rp.replace(/\\/g, "/").split("/").filter(Boolean);
        const folderIdx = parts.findIndex((p) => /^covers?$/i.test(p));
        if (folderIdx >= 1) {
          const albumPath = parts.slice(0, folderIdx).join("/");
          if (!coverByFolder.has(albumPath)) coverByFolder.set(albumPath, f);
        }
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
      setImportProgress(null);
      setBusy(null);
      if (!options.silent) toast.error("No supported audio files found in folder");
      return 0;
    }

    // Process audio files in batches for smooth progress
    const BATCH = 25;
    const total = audioFiles.length;
    let loadedCount = 0;
    const coverCache = new Map<string, Mp3Tags["cover"]>();
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
        const loaded = await Promise.all(
          batch.map(async (entry) => ({
            ...(await readMp3(
              entry.file,
              entry.relativePath,
              true,
              false,
              entry.handle,
              entry.parentHandle,
            )),
            librarySourceId: options.sourceId,
            libraryRelativePath: options.sourceId
              ? (entry.libraryPath ?? entry.relativePath)
              : undefined,
          })),
        );

        // Auto-assign cover art from /cover/ subfolders
        for (const m of loaded) {
          if (!m.tags.cover && m.folderPath) {
            // Check if any parent path of this file's folder has a cover
            const coverImg = coverByFolder.get(m.folderPath);
            if (coverImg) {
              try {
                let cover = coverCache.get(m.folderPath);
                if (!cover) {
                  const reader = new FileReader();
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = reject;
                    reader.readAsDataURL(coverImg);
                  });
                  const mime = coverImg.type || "image/jpeg";
                  const bin = atob(dataUrl.split(",")[1]);
                  const data = new Uint8Array(bin.length);
                  for (let j = 0; j < bin.length; j++) data[j] = bin.charCodeAt(j);
                  cover = { data, mime, dataUrl };
                  coverCache.set(m.folderPath, cover);
                }
                m.tags.cover = cover;
              } catch { /* skip cover on error */ }
            }
          }
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
      }
    } finally {
      setBusy(null);
      setImportProgress(null);
    }
    return loadedCount;
  }, []);

  const loadDirectoryHandle = useCallback(async (
    directoryHandle: FileSystemDirectoryHandle,
  ) => {
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
      const generation = libraryLoadGeneration.current;
      const entries = await collectDirectoryEntries(
        directoryHandle,
        (count, currentDir) => {
          setImportProgress({
            title: "Scanning folder",
            message: `Found ${count.toLocaleString()} item${count === 1 ? "" : "s"} so far in ${currentDir || directoryHandle.name}…`,
          });
        },
        () => generation !== libraryLoadGeneration.current,
      );
      if (generation !== libraryLoadGeneration.current) return;
      const loaded = await handleAddFolder(entries, { sourceId: source.id, generation });
      if (!loaded) await removeLibrarySource(source.id);
    } catch (e: any) {
      if (e?.name !== "AbortError" && !e?.message?.includes("already active")) {
        toast.error(e?.message || "Folder open failed");
      }
      setBusy(null);
      setImportProgress(null);
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
          const entries = (
            await collectDirectoryEntries(
              source.handle,
              undefined,
              () => restoreGeneration !== libraryLoadGeneration.current,
            )
          ).filter((entry) => !excluded.has(entry.relativePath));
          restoredFiles += await handleAddFolder(entries, {
            sourceId: source.id,
            silent: true,
            generation: restoreGeneration,
          });
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
          restoredFiles += await handleAdd(entries, {
            sourceId: source.id,
            silent: true,
            generation: restoreGeneration,
          });
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
        return { ...f, tags: next, dirty: true };
      }),
    );
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

    const refreshed = new Map<string, Mp3Tags>();
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
            file.file,
            file.meta.path || file.libraryRelativePath || file.file.name,
            true,
            false,
            file.sourceHandle,
            file.sourceDirectoryHandle,
          );
          refreshed.set(file.id, { ...loaded.tags, cover: file.tags.cover });
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
          const tags = refreshed.get(file.id);
          return tags ? { ...file, tags, original: cloneTags(tags), dirty: false } : file;
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
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return;
    const canSaveDirect = targets.every((m) => {
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
        let saved = 0;
        const savedFiles = new Map<
          string,
          { file: File; handle: FileSystemFileHandle; relativePath?: string }
        >();
        for (const m of targets) {
          const originalHandle = m.sourceHandle as WritableFileHandle;
          const allowed = await ensureWritePermission(originalHandle);
          if (!allowed) throw new Error("Write permission was not granted for the selected folder");

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

          const writable = await targetHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          if (shouldRename) {
            await m.sourceDirectoryHandle!.removeEntry(m.file.name);
          }
          const relativePath = m.libraryRelativePath
            ? replacePathFilename(m.libraryRelativePath, targetName)
            : undefined;
          savedFiles.set(m.id, {
            file: await targetHandle.getFile(),
            handle: targetHandle,
            relativePath,
          });
          saved += 1;
          setBusy(`Saving directly… ${saved}/${targets.length}`);
        }

        const savedIds = new Set(targets.map((m) => m.id));
        setFiles((prev) =>
          prev.map((f) =>
            savedIds.has(f.id)
              ? {
                  ...f,
                  file: savedFiles.get(f.id)?.file || f.file,
                  sourceHandle: savedFiles.get(f.id)?.handle || f.sourceHandle,
                  libraryRelativePath:
                    savedFiles.get(f.id)?.relativePath ?? f.libraryRelativePath,
                  meta: {
                    ...f.meta,
                    path: replacePathFilename(
                      f.meta.path,
                      savedFiles.get(f.id)?.file.name || f.file.name,
                    ),
                  },
                  renamedBase: undefined,
                  dirty: false,
                  original: cloneTags(f.tags),
                }
              : f,
          ),
        );
        toast.success(`Saved ${saved} file${saved > 1 ? "s" : ""} directly`);
      } else if (targets.length === 1) {
        const m = targets[0];
        const blob = await writeTagsToBlob(m);
        const name = renamedFilename(m, pattern);
        triggerDownload(blob, name);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, dirty: false, original: cloneTags(f.tags) }
              : f,
          ),
        );
        toast.info("Browser file input is read-only, so this file was exported");
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
        const targetIds = new Set(targets.map((m) => m.id));
        setFiles((prev) =>
          prev.map((f) =>
            targetIds.has(f.id)
              ? { ...f, dirty: false, original: cloneTags(f.tags) }
              : f,
          ),
        );
        toast.info("These files were opened read-only, so TagMaestro exported a zip");
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
      <header className="relative z-30 shrink-0 border-b border-border bg-sidebar/60 backdrop-blur px-3 py-2 flex items-center gap-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center shadow-[0_0_0_1px_var(--border)]">
            <Music4 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">TagMaestro</h1>
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
              : selectedFiles.some((f) => f.dirty)
                ? `Save changes in selected files`
                : "Save all unsaved changes"
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          Save all
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
                onCoverClear={() => applyToSelected({ cover: undefined })}
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
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <span className="truncate text-xs font-medium">{importProgress.title}</span>
        {hasNums && (
          <>
            <div className="h-1.5 w-24 overflow-hidden rounded-sm bg-muted shrink-0">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] whitespace-nowrap">
              {importProgress.loaded} / {importProgress.total}
            </span>
          </>
        )}
        {!hasNums && (
          <span className="truncate text-[11px]">{importProgress.message}</span>
        )}
        {onCancel && (
          <button
            type="button"
            className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shrink-0"
            onClick={onCancel}
            title="Cancel import"
            aria-label="Cancel import"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    );
  }

  if (status) {
    return (
      <span className="flex min-w-0 max-w-[260px] items-center gap-1.5 truncate text-muted-foreground" title={status}>
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{status}</span>
        {onCancel && (
          <button
            type="button"
            className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary shrink-0"
            onClick={onCancel}
            title="Cancel"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
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
        <p className="mt-1 text-[11px] text-muted-foreground">MP3 · M4A · FLAC · WAV</p>
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
function FileTable({
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
}) {
  const [visibleColumns, setVisibleColumns] = useState<Set<TableColumnKey>>(
    () => new Set(DEFAULT_VISIBLE_COLUMNS),
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  
  // Column reordering order state
  const [columnOrder, setColumnOrder] = useState<TableColumnKey[]>(() =>
    TABLE_COLUMNS.map((c) => c.key),
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
  const [sortKey, setSortKey] = useState<TableColumnKey | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Container ref to directly set CSS variables on DOM during resize
  const containerRef = useRef<HTMLDivElement>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(1000);
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // Reset current page when the files count, search filter, or sort key/order changes
  useEffect(() => {
    setCurrentPage(1);
  }, [files.length, filter, sortKey, sortOrder]);

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
      <div className="flex-1 overflow-auto bg-white text-slate-950 dark:bg-background dark:text-foreground">
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
                  data-selected={isSel}
                  className="h-6 border-b border-slate-200 bg-white hover:bg-slate-50 data-[selected=true]:bg-blue-50 data-[selected=true]:hover:bg-blue-100 dark:border-border/60 dark:bg-transparent dark:hover:bg-accent/40 dark:data-[selected=true]:bg-primary/10 dark:data-[selected=true]:hover:bg-primary/15"
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

      {/* Pagination Footer */}
      <div className="relative border-t border-border px-4 py-2 flex items-center justify-between text-xs bg-sidebar/40 backdrop-blur select-none h-11 shrink-0">
        <div className="min-w-0 flex flex-1 items-center gap-1.5 text-muted-foreground">
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
              <span>
                <strong className="text-foreground">{selected.size}</strong> selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60"
                onClick={handleClearSelection}
                title="Clear selection"
              >
                Clear selection
              </Button>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          <ProgressOrStatus
            importProgress={importProgress}
            status={status}
            onCancel={onCancelImport}
          />
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md border-border bg-background"
              onClick={() => setCurrentPage(1)}
              disabled={activePage === 1}
              title="First Page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md border-border bg-background"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={activePage === 1}
              title="Previous Page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <span className="mx-2 text-muted-foreground">
              Page <span className="font-medium text-foreground">{activePage}</span> of{" "}
              <span className="font-medium text-foreground">{totalPages}</span>
            </span>

            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md border-border bg-background"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={activePage === totalPages}
              title="Next Page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-md border-border bg-background"
              onClick={() => setCurrentPage(totalPages)}
              disabled={activePage === totalPages}
              title="Last Page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
            </div>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
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

function TdCell({
  value,
  onChange,
  style,
  dirty,
}: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
  dirty?: boolean;
}) {
  return (
    <td style={style} className="px-1 py-px">
      <div className="flex items-center">
        {dirty && <span className="text-primary ml-0.5 mr-1 shrink-0 text-[10px]" title="Modified">●</span>}
        <input
          className="h-5 w-full truncate rounded-none bg-transparent px-1.5 py-0 text-[11px] leading-none text-slate-950 outline-none focus:bg-white focus:ring-1 focus:ring-primary dark:text-foreground dark:focus:bg-background"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </td>
  );
}

function EditorPanel({
  tags,
  count,
  selectedFiles,
  onChange,
  onCoverPick,
  onCoverClear,
  onCollapse,
}: {
  tags: Mp3Tags;
  count: number;
  selectedFiles: Mp3File[];
  onChange: (key: TagKey, value: string) => void;
  onCoverPick: (file: File) => void;
  onCoverClear: () => void;
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
                alt="Cover"
                className="h-full w-full object-cover"
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
                >
                  Upload
                </Button>
                {tags.cover && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={onCoverClear}
                  >
                    Clear
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
        {FIELDS.map((f) =>
          f.key === "comment" ? (
            <div key={f.key} className="space-y-px">
              <Label className="text-[11px] leading-none text-foreground">{f.label}</Label>
              <Textarea
                disabled={count === 0}
                value={tags.comment === MULTI ? "" : tags.comment}
                placeholder={tags.comment === MULTI ? "<multiple values>" : ""}
                onChange={(e) => onChange("comment", e.target.value)}
                className="min-h-[32px] rounded-[1px] border-border bg-white px-1.5 py-0.5 text-[11px] leading-4 text-foreground shadow-none focus-visible:bg-white focus-visible:ring-0 focus-visible:border-primary dark:bg-background dark:focus-visible:bg-background"
              />
            </div>
          ) : (
            <div key={f.key} className="space-y-px">
              <Label className="text-[11px] leading-none text-foreground">{f.label}</Label>
              <TagFieldCombo
                disabled={count === 0}
                value={tags[f.key]}
                options={fieldOptions[f.key] || []}
                onChange={(v) => onChange(f.key, v)}
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function TagFieldCombo({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  const isMulti = value === MULTI;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!comboRef.current?.contains(event.target as Node)) {
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
    <div ref={comboRef} className="relative">
      <Input
        disabled={disabled}
        value={isMulti ? "" : value}
        placeholder={isMulti ? "<keep>" : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-[22px] rounded-[1px] border-border bg-white px-1.5 py-0 pr-6 text-[11px] leading-none text-foreground shadow-none focus-visible:bg-white focus-visible:ring-0 focus-visible:border-primary dark:bg-background dark:focus-visible:bg-background"
      />
      <button
        type="button"
        disabled={disabled}
        className="absolute right-0.5 top-1/2 grid h-[18px] w-5 -translate-y-1/2 place-items-center rounded-sm text-foreground hover:bg-accent hover:text-foreground disabled:opacity-100"
        aria-label="Choose value"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-px max-h-40 w-auto overflow-auto rounded-none border border-[#c8c8c8] p-0 text-[10.5px] leading-none shadow-none [background:Canvas] [color:CanvasText]"
        >
          <button
            type="button"
            className="block h-[18px] w-full px-1.5 py-0 text-left text-[10.5px] italic leading-[18px] [color:GrayText] hover:[background:Highlight] hover:[color:HighlightText] focus:[background:Highlight] focus:[color:HighlightText] focus:outline-none"
            onClick={() => {
              onChange(MULTI);
              setOpen(false);
            }}
          >
            &lt;keep&gt;
          </button>
          <button
            type="button"
            className="block h-[18px] w-full px-1.5 py-0 text-left text-[10.5px] italic leading-[18px] [color:GrayText] hover:[background:Highlight] hover:[color:HighlightText] focus:[background:Highlight] focus:[color:HighlightText] focus:outline-none"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            &lt;blank&gt;
          </button>
          {options.length > 0 && <div className="my-px border-t border-[#d8d8d8]" />}
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="block h-[18px] w-full truncate px-1.5 py-0 text-left text-[10.5px] leading-[18px] hover:[background:Highlight] hover:[color:HighlightText] focus:[background:Highlight] focus:[color:HighlightText] focus:outline-none"
              title={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
          {options.length === 0 && (
            <div className="h-[18px] px-1.5 py-0 text-[10.5px] italic leading-[18px] [color:GrayText]">No values in selection</div>
          )}
        </div>
      )}
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
