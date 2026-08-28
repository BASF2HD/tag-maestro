import { useEffect, useMemo, useState } from "react";
import { Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Mp3File, Mp3Tags } from "@/lib/mp3";

export type ExtractTagKey = keyof Omit<Mp3Tags, "cover">;
export type ExtractSourceKey = ExtractTagKey | "filename" | "folder" | "path";
export type ExtractTargetKey = ExtractTagKey | "filename";

type ExtractField = { key: ExtractSourceKey; label: string };

const SOURCE_FIELDS: ExtractField[] = [
  { key: "filename", label: "Filename" },
  { key: "folder", label: "Folder" },
  { key: "path", label: "Path" },
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
  { key: "track", label: "Track" },
  { key: "bpm", label: "BPM" },
];

const TARGET_FIELDS: ExtractField[] = SOURCE_FIELDS.filter(
  (field) => !["folder", "path"].includes(field.key),
);

type PreviewRow = {
  id: string;
  filename: string;
  source: string;
  before: string;
};

function baseName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function sourceValue(file: Mp3File, source: ExtractSourceKey): string {
  if (source === "filename") return file.renamedBase ?? baseName(file.file.name);
  if (source === "folder") return file.editedFolderName || file.folderName;
  if (source === "path") return file.meta.path || file.libraryRelativePath || file.file.name;
  return file.tags[source] || "";
}

function targetValue(file: Mp3File, target: ExtractTargetKey): string {
  if (target === "filename") return file.renamedBase ?? baseName(file.file.name);
  return file.tags[target] || "";
}

function filenameValue(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function ExtractTextDialog({
  open,
  onOpenChange,
  files,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Mp3File[];
  onApply: (field: ExtractTargetKey, changes: Map<string, string>) => void;
}) {
  const [source, setSource] = useState<ExtractSourceKey>("title");
  const [target, setTarget] = useState<ExtractTargetKey>("album");
  const [findText, setFindText] = useState("");
  const [writeText, setWriteText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  useEffect(() => {
    if (open) {
      setFindText("");
      setWriteText("");
      setCaseSensitive(false);
      setOverwriteExisting(false);
    }
  }, [open]);

  const result = useMemo(() => {
    const changes = new Map<string, string>();
    const preview: PreviewRow[] = [];
    let matches = 0;
    let skippedPopulated = 0;
    if (source === target) return { changes, preview, matches, skippedPopulated };
    const needle = findText.trim();
    const value = target === "filename" ? filenameValue(writeText || needle) : writeText || needle;
    if (!needle || !value) return { changes, preview, matches, skippedPopulated };

    const normalizedNeedle = caseSensitive ? needle : needle.toLocaleLowerCase();
    for (const file of files) {
      const currentSource = sourceValue(file, source);
      const comparableSource = caseSensitive ? currentSource : currentSource.toLocaleLowerCase();
      if (!comparableSource.includes(normalizedNeedle)) continue;
      matches += 1;

      const before = targetValue(file, target);
      if (before && !overwriteExisting) {
        skippedPopulated += 1;
        continue;
      }
      if (before === value) continue;
      changes.set(file.id, value);
      preview.push({
        id: file.id,
        filename: file.file.name,
        source: currentSource,
        before,
      });
    }
    return { changes, preview, matches, skippedPopulated };
  }, [caseSensitive, files, findText, overwriteExisting, source, target, writeText]);

  const restoreChanges = useMemo(() => {
    const changes = new Map<string, string>();
    for (const file of files) {
      const current = targetValue(file, target);
      const original = target === "filename" ? baseName(file.file.name) : file.original[target] || "";
      if (current !== original) changes.set(file.id, original);
    }
    return changes;
  }, [files, target]);

  const sourceLabel = SOURCE_FIELDS.find((field) => field.key === source)?.label ?? source;
  const targetLabel = TARGET_FIELDS.find((field) => field.key === target)?.label ?? target;
  const valueLabel = target === "filename"
    ? filenameValue(writeText || findText.trim())
    : writeText || findText.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(540px,86vh)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
              <Search className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base">Extract Text to Tag</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Find a phrase in one column and write it to another tag.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="extract-source" className="text-[11px] text-muted-foreground">
              Find in
            </Label>
            <select
              id="extract-source"
              value={source}
              onChange={(event) => setSource(event.currentTarget.value as ExtractSourceKey)}
              className="h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              {SOURCE_FIELDS.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="extract-target" className="text-[11px] text-muted-foreground">
              Put in
            </Label>
            <select
              id="extract-target"
              value={target}
              onChange={(event) => setTarget(event.currentTarget.value as ExtractTargetKey)}
              className="h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              {TARGET_FIELDS.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="extract-find" className="text-[11px] text-muted-foreground">
              Text to find
            </Label>
            <Input
              id="extract-find"
              value={findText}
              onChange={(event) => setFindText(event.target.value)}
              placeholder="Dharma Durai"
              className="h-8 text-xs"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="extract-value" className="text-[11px] text-muted-foreground">
              Value to write
            </Label>
            <Input
              id="extract-value"
              value={writeText}
              onChange={(event) => setWriteText(event.target.value)}
              placeholder="Same as text found"
              className="h-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.currentTarget.checked)}
              className="h-3 w-3 accent-primary"
            />
            Match case
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={(event) => setOverwriteExisting(event.currentTarget.checked)}
              className="h-3 w-3 accent-primary"
            />
            Overwrite existing {targetLabel} values
          </label>
          {source === target && (
            <p className="text-[11px] text-destructive sm:col-span-2">
              Choose a different source and destination to extract text. Restoring the original field is still available.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-b border-border bg-sidebar/20 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Preview</span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {result.matches > 0 && <span>{result.matches} matched</span>}
            {result.skippedPopulated > 0 && <span>{result.skippedPopulated} populated skipped</span>}
            <span>{result.changes.size} change{result.changes.size === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {result.preview.length ? (
            <div className="divide-y divide-border/60">
              {(() => {
                const row = result.preview[0];
                return (
                <div key={row.id} className="grid gap-1 px-4 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.filename}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {sourceLabel}: {row.source}
                    </div>
                  </div>
                  <div className="truncate text-muted-foreground sm:text-right">
                    {targetLabel}: {row.before || "<empty>"} → {valueLabel}
                  </div>
                </div>
                );
              })()}
              {result.preview.length > 1 && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                  Showing one example from {result.preview.length} matching files.
                </p>
              )}
            </div>
          ) : (
            <div className="grid h-full min-h-28 place-items-center px-4 text-center text-xs text-muted-foreground">
              Enter text to preview matching files.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="sm:mr-auto"
            onClick={() => {
              onApply(target, restoreChanges);
              onOpenChange(false);
            }}
            disabled={!restoreChanges.size}
          >
            Restore original {targetLabel} ({restoreChanges.size})
          </Button>
          <Button
            onClick={() => {
              onApply(target, result.changes);
              onOpenChange(false);
            }}
            disabled={!result.changes.size}
          >
            Apply to {files.length} file{files.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
