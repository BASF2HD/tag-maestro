import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Type } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Mp3File } from "@/lib/mp3";
import {
  CONVERTER_FIELDS,
  FORMAT_PLACEHOLDERS,
  formatTagTemplate,
  parseFilenameTemplate,
  sanitizeFilenameBase,
  type ConverterTagKey,
} from "@/lib/tag-converter";

type ConverterMode = "tag-filename" | "filename-tag" | "tag-tag";

export type ConverterPatch = {
  tags?: Partial<Record<ConverterTagKey, string>>;
  renamedBase?: string;
};

type PreviewRow = {
  id: string;
  filename: string;
  before: string;
  after: string;
};

const PRESETS: Record<ConverterMode, string[]> = {
  "tag-filename": [
    "$num(%track%,2) - %title%",
    "%artist% - %title%",
    "%albumartist% - %album% - $num(%track%,2) - %title%",
  ],
  "filename-tag": ["%track% - %title%", "%artist% - %title%", "%artist%/%album%/%track% - %title%"],
  "tag-tag": ["%artist%", "%album%", "%albumartist% - %album%", "%filename%"],
};

const DEFAULT_FORMAT: Record<ConverterMode, string> = {
  "tag-filename": "$num(%track%,2) - %title%",
  "filename-tag": "%track% - %title%",
  "tag-tag": "%artist%",
};

function baseName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function fieldLabel(key: ConverterTagKey) {
  return CONVERTER_FIELDS.find((field) => field.key === key)?.label ?? key;
}

export function TagConverterDialog({
  open,
  onOpenChange,
  files,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Mp3File[];
  onApply: (changes: Map<string, ConverterPatch>) => void;
}) {
  const [mode, setMode] = useState<ConverterMode>("filename-tag");
  const [format, setFormat] = useState(DEFAULT_FORMAT["filename-tag"]);
  const [targetField, setTargetField] = useState<ConverterTagKey>("albumArtist");
  const [placeholder, setPlaceholder] = useState("");

  useEffect(() => {
    if (open) setPlaceholder("");
  }, [open]);

  const result = useMemo(() => {
    const changes = new Map<string, ConverterPatch>();
    const preview: PreviewRow[] = [];
    let unmatched = 0;

    for (const file of files) {
      if (mode === "tag-filename") {
        const before = baseName(file.file.name);
        const next = sanitizeFilenameBase(formatTagTemplate(file, format), before);
        if (next !== before) {
          changes.set(file.id, { renamedBase: next });
          preview.push({ id: file.id, filename: file.file.name, before, after: next });
        }
        continue;
      }

      if (mode === "tag-tag") {
        const before = file.tags[targetField];
        const next = formatTagTemplate(file, format).trim();
        if (next !== before) {
          changes.set(file.id, { tags: { [targetField]: next } });
          preview.push({ id: file.id, filename: file.file.name, before, after: next });
        }
        continue;
      }

      const parsed = parseFilenameTemplate(file, format);
      if (!parsed) {
        unmatched += 1;
        continue;
      }
      const changedTags: Partial<Record<ConverterTagKey, string>> = {};
      const beforeParts: string[] = [];
      const afterParts: string[] = [];
      for (const [key, value] of Object.entries(parsed) as Array<[ConverterTagKey, string]>) {
        if (file.tags[key] === value) continue;
        changedTags[key] = value;
        beforeParts.push(`${fieldLabel(key)}: ${file.tags[key] || "<empty>"}`);
        afterParts.push(`${fieldLabel(key)}: ${value}`);
      }
      if (Object.keys(changedTags).length) {
        changes.set(file.id, { tags: changedTags });
        preview.push({
          id: file.id,
          filename: file.file.name,
          before: beforeParts.join(" · "),
          after: afterParts.join(" · "),
        });
      }
    }
    return { changes, preview, unmatched };
  }, [files, format, mode, targetField]);

  function changeMode(nextMode: ConverterMode) {
    setMode(nextMode);
    setFormat(DEFAULT_FORMAT[nextMode]);
  }

  function insertPlaceholder(value: string) {
    if (!value) return;
    setFormat((current) => `${current}${value}`);
    setPlaceholder("");
  }

  function apply() {
    if (!result.changes.size) return;
    onApply(result.changes);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,86vh)] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/15 text-primary">
              <Type className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base">Convert Tags</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {files.length} selected file{files.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => changeMode(value as ConverterMode)}>
          <TabsList className="h-10 w-full justify-start gap-1 border-b border-border bg-sidebar/20 px-3">
            <TabsTrigger value="tag-filename" className="h-7 text-xs">
              Tag → Filename
            </TabsTrigger>
            <TabsTrigger value="filename-tag" className="h-7 text-xs">
              Filename → Tag
            </TabsTrigger>
            <TabsTrigger value="tag-tag" className="h-7 text-xs">
              Tag → Tag
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 border-b border-border bg-background px-4 py-3">
          {mode === "tag-tag" && (
            <div className="space-y-1">
              <Label htmlFor="converter-target" className="text-[11px] text-muted-foreground">
                Target field
              </Label>
              <select
                id="converter-target"
                value={targetField}
                onChange={(event) => setTargetField(event.currentTarget.value as ConverterTagKey)}
                className="h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
              >
                {CONVERTER_FIELDS.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={`space-y-1 ${mode === "tag-tag" ? "" : "col-span-1"}`}>
            <Label htmlFor="converter-format" className="text-[11px] text-muted-foreground">
              Format string
            </Label>
            <Input
              id="converter-format"
              list={`converter-presets-${mode}`}
              value={format}
              onChange={(event) => setFormat(event.target.value)}
              className="h-8 font-mono text-xs"
            />
            <datalist id={`converter-presets-${mode}`}>
              {PRESETS[mode].map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="converter-field" className="text-[11px] text-muted-foreground">
              Insert field
            </Label>
            <select
              id="converter-field"
              value={placeholder}
              onChange={(event) => insertPlaceholder(event.currentTarget.value)}
              className="h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="">Choose field…</option>
              {FORMAT_PLACEHOLDERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-border bg-sidebar/20 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Preview</span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {mode === "filename-tag" && result.unmatched > 0 && (
              <span>{result.unmatched} unmatched</span>
            )}
            <span>{result.changes.size} changes</span>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {result.preview.length ? (
            <div className="divide-y divide-border/60">
              {result.preview.slice(0, 300).map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[150px_minmax(0,1fr)_20px_minmax(0,1fr)] items-center gap-2 px-4 py-2 text-xs"
                >
                  <span className="truncate text-muted-foreground" title={row.filename}>
                    {row.filename}
                  </span>
                  <span className="truncate font-mono text-muted-foreground" title={row.before}>
                    {row.before || "<empty>"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate font-mono text-foreground" title={row.after}>
                    {row.after || "<empty>"}
                  </span>
                </div>
              ))}
              {result.preview.length > 300 && (
                <div className="px-4 py-2 text-center text-xs text-muted-foreground">
                  {result.preview.length - 300} more changes
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-32 place-items-center text-xs text-muted-foreground">
              {mode === "filename-tag" && result.unmatched
                ? "Format does not match the filenames"
                : "No changes"}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="items-center justify-between border-t border-border px-4 py-3 sm:space-x-0">
          <Badge variant="outline" className="h-5 rounded-sm text-[11px]">
            {result.changes.size} file{result.changes.size === 1 ? "" : "s"}
          </Badge>
          <div className="flex gap-2">
            <Button variant="ghost" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="h-8 text-xs" disabled={!result.changes.size} onClick={apply}>
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
