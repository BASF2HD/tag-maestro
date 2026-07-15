import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import {
  readMp3,
  writeTagsToBlob,
  dataUrlToCover,
  renameByPattern,
  emptyTags,
  SUPPORTED_EXTS,
  SUPPORTED_ACCEPT,
  type Mp3File,
  type Mp3Tags,
} from "@/lib/mp3";
import {
  aiParseFilename,
  aiIdentify,
  aiCleanup,
  aiGenerateCover,
} from "@/lib/ai.functions";

export const Route = createFileRoute("/")({
  component: TagForge,
});

const MULTI = "<keep>";

type TagKey = keyof Omit<Mp3Tags, "cover">;
const FIELDS: { key: TagKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "track", label: "Track" },
];

function TagForge() {
  const [files, setFiles] = useState<Mp3File[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [pattern, setPattern] = useState("%artist% - %title%");
  const [filter, setFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
        f.tags.album.toLowerCase().includes(q),
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
      const loaded = await Promise.all(arr.map((f) => readMp3(f)));
      setFiles((prev) => [...prev, ...loaded]);
      toast.success(`Loaded ${loaded.length} file${loaded.length > 1 ? "s" : ""}`);
      const nonMp3 = loaded.filter((f) => f.format !== "mp3").length;
      if (nonMp3) {
        toast.info(
          `${nonMp3} non-MP3 file${nonMp3 > 1 ? "s" : ""}: tag writing not yet supported for M4A/FLAC/WAV — original bytes will be exported with your rename pattern.`,
          { duration: 6000 },
        );
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) void handleAdd(e.dataTransfer.files);
  };

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
        const blob = writeTagsToBlob(m);
        const name = renamedFilename(m, pattern);
        triggerDownload(blob, name);
      } else {
        const zip = new JSZip();
        for (const m of targets) {
          const blob = writeTagsToBlob(m);
          const name = renamedFilename(m, pattern);
          zip.file(uniqueName(zip, name), blob);
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
    try {
      for (const m of targets) {
        const out = await parseFilename({ data: { filename: m.file.name } });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out) }, dirty: true }
              : f,
          ),
        );
      }
      toast.success("Filled from filenames");
    } catch (e: any) {
      toast.error(e?.message || "AI failed");
    } finally {
      setBusy(null);
    }
  }

  async function runAiIdentify() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`AI identifying ${targets.length} track${targets.length > 1 ? "s" : ""}…`);
    try {
      for (const m of targets) {
        const out = await identify({
          data: {
            filename: m.file.name,
            current: tagsToRecord(m.tags),
          },
        });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out) }, dirty: true }
              : f,
          ),
        );
      }
      toast.success("Identified");
    } catch (e: any) {
      toast.error(e?.message || "AI failed");
    } finally {
      setBusy(null);
    }
  }

  async function runAiCleanup() {
    const targets = selectedFiles.length ? selectedFiles : files;
    if (!targets.length) return toast.info("Select files first");
    setBusy(`AI cleaning ${targets.length} track${targets.length > 1 ? "s" : ""}…`);
    try {
      for (const m of targets) {
        const out = await cleanup({ data: { tags: tagsToRecord(m.tags) } });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === m.id
              ? { ...f, tags: { ...f.tags, ...pickNonEmpty(out) }, dirty: true }
              : f,
          ),
        );
      }
      toast.success("Tags cleaned");
    } catch (e: any) {
      toast.error(e?.message || "AI failed");
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
      toast.error(e?.message || "AI failed");
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
        <Button size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="mr-1.5 h-4 w-4" />
          Add files
        </Button>
        <Button size="sm" variant="secondary" onClick={saveAll} disabled={!files.length}>
          <Save className="mr-1.5 h-4 w-4" />
          Save {selectedFiles.length ? `(${selectedFiles.length})` : "all"}
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
              onToggle={(id, additive) => {
                setSelected((prev) => {
                  const next = new Set(additive ? prev : []);
                  if (prev.has(id) && additive) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onSelectAll={(all) => setSelected(all ? new Set(filtered.map((f) => f.id)) : new Set())}
              onEdit={updateTag}
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

function FileTable({
  files,
  selected,
  onToggle,
  onSelectAll,
  onEdit,
}: {
  files: Mp3File[];
  selected: Set<string>;
  onToggle: (id: string, additive: boolean) => void;
  onSelectAll: (all: boolean) => void;
  onEdit: (id: string, key: TagKey, value: string) => void;
}) {
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id));
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-sidebar text-muted-foreground">
          <tr className="border-b border-border">
            <th className="w-8 px-2 py-2 text-left">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => onSelectAll(Boolean(v))}
                aria-label="Select all"
              />
            </th>
            <th className="px-2 py-2 text-left font-medium">Title</th>
            <th className="px-2 py-2 text-left font-medium">Artist</th>
            <th className="px-2 py-2 text-left font-medium">Album</th>
            <th className="px-2 py-2 text-left font-medium w-16">Year</th>
            <th className="px-2 py-2 text-left font-medium w-14">Track</th>
            <th className="px-2 py-2 text-left font-medium">Genre</th>
            <th className="px-2 py-2 text-left font-medium">Filename</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const isSel = selected.has(f.id);
            return (
              <tr
                key={f.id}
                data-selected={isSel}
                className="border-b border-border/60 hover:bg-accent/40 data-[selected=true]:bg-primary/10 data-[selected=true]:hover:bg-primary/15"
                onClick={(e) => onToggle(f.id, e.metaKey || e.ctrlKey || e.shiftKey)}
              >
                <td className="px-2 py-1.5">
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => onToggle(f.id, true)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Select"
                  />
                </td>
                <TdCell value={f.tags.title} onChange={(v) => onEdit(f.id, "title", v)} />
                <TdCell value={f.tags.artist} onChange={(v) => onEdit(f.id, "artist", v)} />
                <TdCell value={f.tags.album} onChange={(v) => onEdit(f.id, "album", v)} />
                <TdCell value={f.tags.year} onChange={(v) => onEdit(f.id, "year", v)} />
                <TdCell value={f.tags.track} onChange={(v) => onEdit(f.id, "track", v)} />
                <TdCell value={f.tags.genre} onChange={(v) => onEdit(f.id, "genre", v)} />
                <td
                  className="px-2 py-1.5 text-muted-foreground truncate max-w-[220px]"
                  title={f.file.name}
                >
                  {f.dirty && <span className="text-primary mr-1">●</span>}
                  {f.file.name}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TdCell({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <td className="px-1 py-0.5">
      <input
        className="w-full bg-transparent px-1.5 py-1 rounded outline-none focus:bg-background focus:ring-1 focus:ring-primary"
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
  onChange: (key: TagKey | "comment", value: string) => void;
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
        {FIELDS.map((f) => (
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
        ))}
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Comment</Label>
          <Textarea
            disabled={count === 0}
            value={tags.comment === MULTI ? "" : tags.comment}
            placeholder={tags.comment === MULTI ? "<multiple values>" : ""}
            onChange={(e) => onChange("comment", e.target.value)}
            className="text-sm min-h-[70px]"
          />
        </div>
      </div>
    </div>
  );
}

// ==== helpers ====

function tagsToRecord(t: Mp3Tags): Record<string, string> {
  const { cover: _c, ...rest } = t;
  return rest as Record<string, string>;
}

function pickNonEmpty(o: Record<string, string | undefined>): Partial<Mp3Tags> {
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
