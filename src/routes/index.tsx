import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Music4,
  Upload,
  Save,
  Sparkles,
  Wand2,
  Image as ImageIcon,
  FileText,
  Trash2,
  Download,
  Loader2,
  Search,
  MoreVertical,
  FolderOpen,
  FolderTree,
  FolderEdit,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Sun,
  Moon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  aiParseFilename,
  aiIdentify,
  aiCleanup,
  aiGenerateCover,
} from "@/lib/ai.functions";
import { FolderRenameDialog } from "@/components/FolderRenameDialog";

export const Route = createFileRoute("/")({
  component: TagForge,
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

function TagForge() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [files, setFiles] = useState<Mp3File[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pattern, setPattern] = useState("%artist% - %title%");
  const [filter, setFilter] = useState("");
  const [folderRenameOpen, setFolderRenameOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const rootFolderInput = useRef<HTMLInputElement>(null);

  const parseFilename = useServerFn(aiParseFilename);
  const identify = useServerFn(aiIdentify);
  const cleanup = useServerFn(aiCleanup);
  const genCover = useServerFn(aiGenerateCover);

  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.id)),
    [files, selected],
  );
  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.file.name.toLowerCase().includes(q) ||
        f.tags.title.toLowerCase().includes(q) ||
        f.tags.artist.toLowerCase().includes(q) ||
        f.tags.album.toLowerCase().includes(q) ||
        f.editedFolderName.toLowerCase().includes(q),
    );
  }, [files, filter]);

  const handleAdd = useCallback(async (list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => {
      const n = f.name.toLowerCase();
      return SUPPORTED_EXTS.some((ext) => n.endsWith(ext));
    });
    if (!arr.length) {
      toast.error("No supported audio files (MP3, M4A, FLAC, WAV)");
      return;
    }
    setBusy(`Reading ${arr.length} file${arr.length > 1 ? "s" : ""}…`);
    try {
      const skipAudio = arr.length > 10;
      const loaded = await Promise.all(arr.map((f) => readMp3(f, undefined, skipAudio)));
      setFiles((prev) => [...prev, ...loaded]);
      toast.success(`Loaded ${loaded.length} file${loaded.length > 1 ? "s" : ""}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) void handleAdd(e.dataTransfer.files);
  };

  /** Handle adding files from a folder picker (single folder or root with subfolders). */
  const handleAddFolder = useCallback(async (list: FileList | File[]) => {
    const allFiles = Array.from(list);
    // Separate audio files and image files
    const audioFiles = allFiles.filter((f) => {
      const n = f.name.toLowerCase();
      return SUPPORTED_EXTS.some((ext) => n.endsWith(ext));
    });
    const imageFiles = allFiles.filter((f) => {
      const n = f.name.toLowerCase();
      return IMAGE_EXTS.some((ext) => n.endsWith(ext));
    });
    if (!audioFiles.length) {
      toast.error("No supported audio files found in folder");
      return;
    }

    // Build a map of folder path -> cover image file (from /cover/ subfolders)
    const coverByFolder = new Map<string, File>();
    for (const img of imageFiles) {
      const rp = (img as File & { webkitRelativePath?: string }).webkitRelativePath || "";
      const parts = rp.replace(/\\/g, "/").split("/").filter(Boolean);
      // Check if image is inside a "cover" or "covers" subfolder
      const folderIdx = parts.findIndex((p) => /^covers?$/i.test(p));
      if (folderIdx >= 1) {
        // The album folder is everything before the "cover" folder
        const albumPath = parts.slice(0, folderIdx).join("/");
        if (!coverByFolder.has(albumPath)) {
          coverByFolder.set(albumPath, img);
        }
      }
    }

    // Process audio files in batches for smooth progress
    const BATCH = 50;
    const total = audioFiles.length;
    let loadedCount = 0;
    setBusy(`Reading files… 0/${total}`);
    try {
      for (let i = 0; i < total; i += BATCH) {
        const batch = audioFiles.slice(i, i + BATCH);
        const loaded = await Promise.all(
          batch.map((f) => {
            const rp = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
            return readMp3(f, rp, true);
          }),
        );

        // Auto-assign cover art from /cover/ subfolders
        for (const m of loaded) {
          if (!m.tags.cover && m.folderPath) {
            // Check if any parent path of this file's folder has a cover
            const coverImg = coverByFolder.get(m.folderPath);
            if (coverImg) {
              try {
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
                m.tags.cover = { data, mime, dataUrl };
              } catch { /* skip cover on error */ }
            }
          }
        }

        setFiles((prev) => [...prev, ...loaded]);
        loadedCount += loaded.length;
        setBusy(`Reading files… ${loadedCount}/${total}`);
      }
      toast.success(`Loaded ${loadedCount} file${loadedCount > 1 ? "s" : ""} from folder`);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Update folder name for a single file, propagating to all files in the same original folder. */
  function updateFolderName(id: string, newName: string) {
    const target = files.find((f) => f.id === id);
    if (!target) return;
    const origFolder = target.folderName;
    setFiles((prev) =>
      prev.map((f) =>
        f.folderName === origFolder ? { ...f, editedFolderName: newName } : f,
      ),
    );
  }

  /** Apply bulk folder renames from the dialog. */
  function handleFolderRenames(renames: Map<string, string>) {
    setFiles((prev) =>
      prev.map((f) => {
        const newName = renames.get(f.editedFolderName);
        return newName !== undefined ? { ...f, editedFolderName: newName } : f;
      }),
    );
    toast.success(`Renamed ${renames.size} folder${renames.size > 1 ? "s" : ""}`);
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
          if (v === undefined || v === MULTI) continue;
          if (k === "cover") next.cover = v as Mp3Tags["cover"];
          else (next as any)[k] = v;
        }
        return { ...f, tags: next, dirty: true };
      }),
    );
  }

  function removeSelected() {
    setFiles((prev) => prev.filter((f) => !selected.has(f.id)));
    setSelected(new Set());
  }

  async function saveAll() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return;
    setBusy(`Packaging ${targets.length} file${targets.length > 1 ? "s" : ""}…`);
    try {
      if (targets.length === 1) {
        const m = targets[0];
        const blob = await writeTagsToBlob(m);
        const name = renamedFilename(m, pattern);
        triggerDownload(blob, name);
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
        triggerDownload(zipBlob, "tagforge-export.zip");
      }
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setBusy(null);
    }
  }

  // === AI actions ===

  async function runAiAutofill() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`AI parsing ${targets.length} filename${targets.length > 1 ? "s" : ""}…`);
    let applied = 0;
    try {
      for (const m of targets) {
        const out = await parseFilename({ data: { filename: m.file.name } });
        if (!out.ok) {
          toast.error(aiErrorMessage(out));
          return;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out.tags) }, dirty: true }
              : f,
          ),
        );
        applied += 1;
      }
      toast.success(`Filled ${applied} file${applied === 1 ? "" : "s"} from filenames`);
    } catch (e: any) {
      toast.error(aiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runAiIdentify() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`AI identifying ${targets.length} track${targets.length > 1 ? "s" : ""}…`);
    let applied = 0;
    try {
      for (const m of targets) {
        const out = await identify({
          data: {
            filename: m.file.name,
            current: tagsToRecord(m.tags),
          },
        });
        if (!out.ok) {
          toast.error(aiErrorMessage(out));
          return;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out.tags) }, dirty: true }
              : f,
          ),
        );
        applied += 1;
      }
      toast.success(`Identified ${applied} track${applied === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(aiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runAiCleanup() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`AI cleaning ${targets.length} track${targets.length > 1 ? "s" : ""}…`);
    let applied = 0;
    try {
      for (const m of targets) {
        const out = await cleanup({ data: { tags: tagsToRecord(m.tags) } });
        if (!out.ok) {
          toast.error(aiErrorMessage(out));
          return;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out.tags) }, dirty: true }
              : f,
          ),
        );
        applied += 1;
      }
      toast.success(`Cleaned ${applied} track${applied === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(aiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runAiCover() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`Generating ${targets.length} cover${targets.length > 1 ? "s" : ""}…`);
    try {
      for (const m of targets) {
        const out = await genCover({
          data: {
            title: m.tags.title,
            artist: m.tags.artist,
            album: m.tags.album,
            genre: m.tags.genre,
          },
        });
        if (!out.ok) {
          toast.error(aiErrorMessage(out));
          return;
        }
        const cover = dataUrlToCover(out.dataUrl);
        if (cover) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === m.id ? { ...f, tags: { ...f.tags, cover }, dirty: true } : f,
            ),
          );
        }
      }
      toast.success("Cover art generated");
    } catch (e: any) {
      toast.error(aiErrorMessage(e));
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
      className="min-h-screen bg-background text-foreground flex flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Toaster theme="dark" position="top-right" />
      <FolderRenameDialog
        open={folderRenameOpen}
        onOpenChange={setFolderRenameOpen}
        folders={folderMap}
        onApply={handleFolderRenames}
      />

      {/* Header */}
      <header className="border-b border-border bg-sidebar/60 backdrop-blur px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center shadow-[0_0_0_1px_var(--border)]">
            <Music4 className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">TagForge</h1>
            <p className="text-[11px] text-muted-foreground -mt-0.5">
              AI audio tag editor · MP3, M4A, FLAC, WAV
            </p>
          </div>
        </div>

        <Separator orientation="vertical" className="h-8 mx-2" />

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
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="mr-1.5 h-4 w-4" />
          Add files
        </Button>
        <Button size="sm" variant="outline" onClick={() => folderInput.current?.click()}>
          <FolderOpen className="mr-1.5 h-4 w-4" />
          Add Folder
        </Button>
        <Button size="sm" variant="outline" onClick={() => rootFolderInput.current?.click()}>
          <FolderTree className="mr-1.5 h-4 w-4" />
          Add Root Folder
        </Button>
        <Button size="sm" variant="secondary" onClick={saveAll} disabled={!files.length}>
          <Save className="mr-1.5 h-4 w-4" />
          Save {selectedFiles.length ? `(${selectedFiles.length})` : "all"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderRenameOpen(true)} disabled={!files.length}>
          <FolderEdit className="mr-1.5 h-4 w-4" />
          Rename Folders
        </Button>

        <Separator orientation="vertical" className="h-8 mx-1" />

        <div className="hidden md:flex items-center gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">
            AI
          </span>
          <Button size="sm" variant="ghost" onClick={runAiAutofill} disabled={!files.length}>
            <FileText className="mr-1.5 h-4 w-4" />
            From filename
          </Button>
          <Button size="sm" variant="ghost" onClick={runAiIdentify} disabled={!files.length}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Identify
          </Button>
          <Button size="sm" variant="ghost" onClick={runAiCleanup} disabled={!files.length}>
            <Wand2 className="mr-1.5 h-4 w-4" />
            Clean up
          </Button>
          <Button size="sm" variant="ghost" onClick={runAiCover} disabled={!files.length}>
            <ImageIcon className="mr-1.5 h-4 w-4" />
            Cover art
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {busy && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {busy}
            </span>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* File table */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {files.length === 0 ? (
            <EmptyState onPick={() => fileInput.current?.click()} />
          ) : (
            <FileTable
              files={filtered}
              selected={selected}
              filter={filter}
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
            />
          )}

          {files.length > 0 && (
            <div className="border-t border-border px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground bg-sidebar/40">
              <span>
                {files.length} file{files.length > 1 ? "s" : ""} · {selectedFiles.length} selected ·{" "}
                {files.filter((f) => f.dirty).length} unsaved
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Label htmlFor="pattern" className="text-xs text-muted-foreground">
                  Rename:
                </Label>
                <Input
                  id="pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="h-7 w-64 text-xs font-mono"
                  placeholder="%artist% - %title%"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={removeSelected}
                  disabled={!selected.size}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          )}
        </main>

        {/* Editor panel */}
        <aside className="w-[340px] border-l border-border bg-sidebar/40 flex flex-col overflow-hidden">
          <EditorPanel
            tags={panelTags}
            count={selectedFiles.length}
            onChange={(key, value) => applyToSelected({ [key]: value })}
            onCoverPick={onCoverFile}
            onCoverClear={() => applyToSelected({ cover: undefined })}
          />
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-8">
      <div className="max-w-md text-center border border-dashed border-border rounded-xl p-12 bg-card/40">
        <div className="mx-auto mb-4 h-12 w-12 rounded-lg bg-primary/15 text-primary grid place-items-center">
          <Upload className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Drop audio files here</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">MP3 · M4A · FLAC · WAV</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything stays in your browser. No uploads, no accounts.
        </p>
        <Button className="mt-5" onClick={onPick}>
          <Upload className="mr-1.5 h-4 w-4" />
          Choose files
        </Button>
        <div className="mt-6 grid grid-cols-2 gap-2 text-left text-xs text-muted-foreground">
          <Feature icon={FileText} title="Auto-fill" desc="Parse tags from filenames" />
          <Feature icon={Sparkles} title="Identify" desc="Find missing metadata" />
          <Feature icon={Wand2} title="Clean up" desc="Normalize titles & artists" />
          <Feature icon={ImageIcon} title="Cover art" desc="Generate album covers" />
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
    <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
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
  onToggle,
  onSelectAll,
  onEdit,
  onEditFolder,
}: {
  files: Mp3File[];
  selected: Set<string>;
  filter: string;
  onToggle: (id: string, additive: boolean) => void;
  onSelectAll: (selected: Set<string>) => void;
  onEdit: (id: string, key: TagKey, value: string) => void;
  onEditFolder: (id: string, value: string) => void;
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
  const [pageSize, setPageSize] = useState(100);

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
    onSelectAll(new Set());
  }

  // High performance resize handler using CSS variables + rAF throttling
  function handleResizeStart(key: TableColumnKey, startEvent: React.MouseEvent) {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const startX = startEvent.clientX;
    const startWidth = columnWidths[key] || defaultWidths[key] || 150;
    let lastWidth = startWidth;
    let rafId = 0;

    function handleMouseMove(moveEvent: MouseEvent) {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(40, startWidth + deltaX);
      lastWidth = newWidth;
      // Throttle DOM writes to one per animation frame
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.style.setProperty(`--col-width-${key}`, `${newWidth}px`);
          }
          rafId = 0;
        });
      }
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (rafId) cancelAnimationFrame(rafId);
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
        <div className="bg-primary/10 border-b border-border/80 px-4 py-1.5 text-xs text-center flex items-center justify-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
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
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse table-fixed">
          {/* Header background stands out (contrasting background with distinct border) */}
          <thead className="sticky top-0 z-10 bg-secondary/80 backdrop-blur-md text-muted-foreground border-b border-border shadow-[0_1px_2px_rgba(0,0,0,0.15)]">
            <tr className="border-b border-border bg-secondary/30">
              <th style={{ width: 36, minWidth: 36, maxWidth: 36 }} className="px-2 py-1.5 text-left">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={(v) => handleHeaderCheckboxChange(Boolean(v))}
                  aria-label="Select page"
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
                    className={`py-1.5 text-left font-semibold text-foreground/80 relative group select-none transition-all ${
                      col.key !== "cover" ? "cursor-grab active:cursor-grabbing hover:bg-accent/30" : ""
                    } ${
                      isOver ? "border-l-2 border-l-primary pl-1.5 pr-2" : "px-2"
                    } ${
                      isDragged ? "opacity-40 bg-accent/20" : ""
                    } ${col.className ?? ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1 truncate pr-3" title={col.label}>
                      <span className="truncate">{col.label}</span>
                      {col.key !== "cover" && (
                        <span className="shrink-0 text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
                          {sortKey === col.key ? (
                            sortOrder === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-primary" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-primary" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Resize handle: wide invisible hit area + visible colored strip */}
                    <div
                      onMouseDown={(e) => handleResizeStart(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 bottom-0 w-3 -mr-1.5 cursor-col-resize z-20 flex items-center justify-center"
                    >
                      <div className="w-0.5 h-full bg-border/30 group-hover:bg-primary/60 group-hover:w-1 transition-all rounded-full" />
                    </div>
                  </th>
                );
              })}
              <th style={{ width: 32, minWidth: 32, maxWidth: 32 }} className="px-1 py-1 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      aria-label="Toggle columns"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 max-h-80 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs">Customize…</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TABLE_COLUMNS.map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={visibleColumns.has(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
                  className="border-b border-border/60 hover:bg-accent/40 data-[selected=true]:bg-primary/10 data-[selected=true]:hover:bg-primary/15"
                  onClick={(e) => onToggle(f.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                >
                  <td style={{ width: 36, minWidth: 36, maxWidth: 36 }} className="px-2 py-1.5">
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => onToggle(f.id, true)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Select"
                    />
                  </td>
                  {visible.map((col) => (
                    <TableCell
                      key={col.key}
                      file={f}
                      col={col}
                      onEdit={onEdit}
                      onEditFolder={onEditFolder}
                    />
                  ))}
                  <td style={{ width: 32, minWidth: 32, maxWidth: 32 }} className="px-1 py-1.5" />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs bg-sidebar/40 backdrop-blur select-none h-11 shrink-0">
        <div className="text-muted-foreground flex items-center gap-1">
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
        </div>

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

        <div className="flex items-center gap-2">
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
          </select>
        </div>
      </div>
    </div>
  );
}

function TableCell({
  file,
  col,
  onEdit,
  onEditFolder,
}: {
  file: Mp3File;
  col: TableColumn;
  onEdit: (id: string, key: TagKey, value: string) => void;
  onEditFolder: (id: string, value: string) => void;
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
      <td style={colStyle} className="px-2 py-1.5">
        {file.tags.cover?.dataUrl ? (
          <img
            src={file.tags.cover.dataUrl}
            alt=""
            className="h-6 w-6 rounded object-cover"
          />
        ) : null}
      </td>
    );
  }

  const readOnly =
    col.kind === "filename"
      ? file.file.name
      : col.kind === "path"
        ? file.meta.path
        : file.meta[col.key as MetaKey];

  return (
    <td
      style={colStyle}
      className="px-2 py-1.5 text-muted-foreground truncate"
      title={readOnly}
    >
      {col.kind === "filename" && file.dirty && (
        <span className="text-primary mr-1">●</span>
      )}
      {readOnly}
    </td>
  );
}

function TdCell({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <td style={style} className="px-1 py-0.5">
      <input
        className="w-full bg-transparent px-1.5 py-1 rounded outline-none focus:bg-background focus:ring-1 focus:ring-primary truncate"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
    </td>
  );
}

function EditorPanel({
  tags,
  count,
  onChange,
  onCoverPick,
  onCoverClear,
}: {
  tags: Mp3Tags;
  count: number;
  onChange: (key: TagKey, value: string) => void;
  onCoverPick: (file: File) => void;
  onCoverClear: () => void;
}) {
  const coverInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-4 border-b border-border">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Editor
        </p>
        <p className="text-sm font-medium mt-0.5">
          {count === 0
            ? "No selection"
            : count === 1
              ? "Editing 1 track"
              : `Editing ${count} tracks`}
        </p>
      </div>

      <div className="p-4">
        <div
          className="aspect-square rounded-md border border-border bg-background/40 grid place-items-center overflow-hidden relative group"
        >
          {tags.cover?.dataUrl ? (
            <img
              src={tags.cover.dataUrl}
              alt="Cover"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-center text-muted-foreground text-xs">
              <ImageIcon className="h-8 w-8 mx-auto mb-1 opacity-50" />
              No cover art
            </div>
          )}
          {count > 0 && (
            <div className="absolute inset-x-0 bottom-0 p-2 flex gap-1 bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 h-7 text-xs"
                onClick={() => coverInput.current?.click()}
              >
                Upload
              </Button>
              {tags.cover && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
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

      <div className="px-4 pb-4 space-y-3">
        {FIELDS.map((f) =>
          f.key === "comment" ? (
            <div key={f.key} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
              <Textarea
                disabled={count === 0}
                value={tags.comment === MULTI ? "" : tags.comment}
                placeholder={tags.comment === MULTI ? "<multiple values>" : ""}
                onChange={(e) => onChange("comment", e.target.value)}
                className="text-sm min-h-[70px]"
              />
            </div>
          ) : (
            <div key={f.key} className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">{f.label}</Label>
              <Input
                disabled={count === 0}
                value={tags[f.key] === MULTI ? "" : tags[f.key]}
                placeholder={tags[f.key] === MULTI ? "<multiple values>" : ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// ==== helpers ====

function tagsToRecord(t: Mp3Tags): Record<string, string> {
  const { cover: _c, ...rest } = t;
  return rest as Record<string, string>;
}

function renamedFilename(m: Mp3File, pattern: string): string {
  const orig = m.file.name;
  const dot = orig.lastIndexOf(".");
  const ext = dot > 0 ? orig.slice(dot) : ".mp3";
  const base = dot > 0 ? orig.slice(0, dot) : orig;
  return renameByPattern(pattern, m.tags, base) + ext;
}

function aiErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "error" in e && typeof (e as { error?: unknown }).error === "string") {
    const err = e as { error: string; status?: number; requestId?: string };
    return err.requestId ? `${err.error} (${err.requestId})` : err.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return "AI failed. Please try again.";
}

function pickNonEmpty(o: Record<string, unknown>): Partial<Mp3Tags> {
  const out: Partial<Mp3Tags> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.trim()) (out as any)[k] = v.trim();
  }
  return out;
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
