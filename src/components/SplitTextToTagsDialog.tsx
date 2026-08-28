import { useMemo, useState } from "react";
import { Plus, Scissors, Trash2 } from "@/components/icons";
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

export type SplitTagKey = keyof Omit<Mp3Tags, "cover">;
export type SplitSourceKey = SplitTagKey | "filename";
export type SplitTagPatch = Partial<Record<SplitTagKey, string>>;

type MappingValue = SplitTagKey | "skip";
type SplitMode = "copy" | "move";

const TAG_FIELDS: Array<{ key: SplitTagKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "album", label: "Album" },
  { key: "artist", label: "Artist" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "track", label: "Track" },
  { key: "discnumber", label: "Discnumber" },
  { key: "tag", label: "Tag" },
  { key: "comment", label: "Comment" },
  { key: "bpm", label: "BPM" },
];

const SOURCE_FIELDS: Array<{ key: SplitSourceKey; label: string }> = [
  { key: "filename", label: "Filename" },
  ...TAG_FIELDS,
];

const DEFAULT_MAPPINGS: MappingValue[] = ["title", "album", "composer", "artist"];
const SEPARATOR_PRESETS = ["|", "_", "-", " - ", "/", ";", "::"];

type PreviewRow = {
  id: string;
  filename: string;
  source: string;
  changes: string[];
};

function baseName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function sourceValue(file: Mp3File, source: SplitSourceKey): string {
  return source === "filename"
    ? file.renamedBase ?? baseName(file.file.name)
    : file.tags[source] || "";
}

function fieldLabel(key: SplitTagKey) {
  return TAG_FIELDS.find((field) => field.key === key)?.label ?? key;
}

export function SplitTextToTagsDialog({
  open,
  onOpenChange,
  files,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Mp3File[];
  onApply: (changes: Map<string, SplitTagPatch>) => void;
}) {
  const [source, setSource] = useState<SplitSourceKey>("title");
  const [delimiter, setDelimiter] = useState("|");
  const [mode, setMode] = useState<SplitMode>("move");
  const [mappings, setMappings] = useState<MappingValue[]>(DEFAULT_MAPPINGS);
  const [trimWhitespace, setTrimWhitespace] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const result = useMemo(() => {
    const changes = new Map<string, SplitTagPatch>();
    const preview: PreviewRow[] = [];
    let unmatched = 0;
    let protectedValues = 0;
    if (!delimiter) return { changes, preview, unmatched, protectedValues };

    for (const file of files) {
      const input = sourceValue(file, source);
      const parts = input
        .split(delimiter)
        .map((part) => (trimWhitespace ? part.trim() : part));
      if (parts.length < mappings.length) {
        unmatched += 1;
        continue;
      }

      const patch: SplitTagPatch = {};
      const descriptions: string[] = [];
      const mappedTargets = new Set<SplitTagKey>();
      mappings.forEach((target, index) => {
        if (target === "skip") return;
        mappedTargets.add(target);
        const value = parts[index] || "";
        if (!value) return;

        const before = file.tags[target] || "";
        if (source !== "filename" && mode === "copy" && target === source) return;
        const replacingSource = source !== "filename" && mode === "move" && target === source;
        if (before && !overwriteExisting && !replacingSource) {
          protectedValues += 1;
          return;
        }
        if (before === value) return;
        patch[target] = value;
        descriptions.push(`${fieldLabel(target)}: ${before || "<empty>"} → ${value}`);
      });

      if (source !== "filename" && mode === "move" && !mappedTargets.has(source)) {
        const before = file.tags[source] || "";
        if (before) {
          patch[source] = "";
          descriptions.push(`${fieldLabel(source)}: ${before} → <empty>`);
        }
      }

      if (Object.keys(patch).length) {
        changes.set(file.id, patch);
        preview.push({ id: file.id, filename: file.file.name, source: input, changes: descriptions });
      }
    }
    return { changes, preview, unmatched, protectedValues };
  }, [delimiter, files, mappings, mode, overwriteExisting, source, trimWhitespace]);

  function updateMapping(index: number, value: MappingValue) {
    setMappings((current) => current.map((mapping, itemIndex) => (itemIndex === index ? value : mapping)));
  }

  function addMapping() {
    setMappings((current) => (current.length < 8 ? [...current, "skip"] : current));
  }

  function removeMapping(index: number) {
    setMappings((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(600px,86vh)] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
              <Scissors className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base">Split Text to Tags</DialogTitle>
              <p className="text-xs text-muted-foreground">
                Split an ordered Title or Filename pattern and map each part to a tag.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_180px]">
          <div className="space-y-1">
            <Label htmlFor="split-source" className="text-[11px] text-muted-foreground">
              Source column
            </Label>
            <select
              id="split-source"
              value={source}
              onChange={(event) => setSource(event.currentTarget.value as SplitSourceKey)}
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
            <Label htmlFor="split-delimiter" className="text-[11px] text-muted-foreground">
              Separator (type or paste)
            </Label>
            <Input
              id="split-delimiter"
              list="split-delimiter-presets"
              value={delimiter}
              onChange={(event) => setDelimiter(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="Type or paste separator"
              className="h-8 font-mono text-xs"
              maxLength={32}
              spellCheck={false}
            />
            <datalist id="split-delimiter-presets">
              {SEPARATOR_PRESETS.map((separator) => (
                <option key={separator} value={separator} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="split-mode" className="text-[11px] text-muted-foreground">
              Source handling
            </Label>
            <select
              id="split-mode"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as SplitMode)}
              className="h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="copy">Copy and keep source</option>
              <option value="move">Move and clean source</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
            <input
              type="checkbox"
              checked={trimWhitespace}
              onChange={(event) => setTrimWhitespace(event.currentTarget.checked)}
              className="h-3 w-3 accent-primary"
            />
            Trim spaces around each part
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-3">
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={(event) => setOverwriteExisting(event.currentTarget.checked)}
              className="h-3 w-3 accent-primary"
            />
            Overwrite existing destination tags
          </label>
          {source === "filename" && mode === "move" && (
            <p className="text-[11px] text-muted-foreground sm:col-span-3">
              Audio filenames remain unchanged; only mapped tags are updated.
            </p>
          )}
        </div>

        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase text-muted-foreground">Part order</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={addMapping}
              disabled={mappings.length >= 8}
            >
              <Plus className="h-3.5 w-3.5" />
              Add part
            </Button>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {mappings.map((mapping, index) => {
              const selectedElsewhere = new Set(
                mappings.filter((_, itemIndex) => itemIndex !== index && mappings[itemIndex] !== "skip"),
              );
              return (
                <div key={index} className="grid grid-cols-[70px_minmax(0,1fr)_28px] items-center gap-2">
                  <span className="text-xs text-muted-foreground">Part {index + 1}</span>
                  <select
                    aria-label={`Tag for part ${index + 1}`}
                    value={mapping}
                    onChange={(event) => updateMapping(index, event.currentTarget.value as MappingValue)}
                    className="h-7 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
                  >
                    <option value="skip">Skip</option>
                    {TAG_FIELDS.map((field) => (
                      <option
                        key={field.key}
                        value={field.key}
                        disabled={selectedElsewhere.has(field.key)}
                      >
                        {field.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove part ${index + 1}`}
                    title={`Remove part ${index + 1}`}
                    className="grid h-7 w-7 place-items-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    onClick={() => removeMapping(index)}
                    disabled={mappings.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-border bg-sidebar/20 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Preview</span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {result.unmatched > 0 && <span>{result.unmatched} pattern mismatch</span>}
            {result.protectedValues > 0 && <span>{result.protectedValues} populated protected</span>}
            <span>{result.changes.size} files changing</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {result.preview.length ? (
            <div className="px-4 py-2 text-xs">
              <div className="truncate font-medium">{result.preview[0].filename}</div>
              <div className="truncate text-[11px] text-muted-foreground">{result.preview[0].source}</div>
              <div className="mt-1 truncate text-[11px] text-foreground">
                {result.preview[0].changes.join(" · ")}
              </div>
              {result.preview.length > 1 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Showing one example from {result.preview.length} files changing.
                </p>
              )}
            </div>
          ) : (
            <div className="grid h-full min-h-24 place-items-center px-4 text-center text-xs text-muted-foreground">
              No matching changes. Check the separator, part order, and overwrite option.
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(result.changes);
              onOpenChange(false);
            }}
            disabled={!result.changes.size}
          >
            Apply {result.changes.size} file{result.changes.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
