import React, { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Wand2,
  Search,
  ArrowRight,
  Plus,
  Scissors,
  CaseSensitive,
  Sparkles,
} from "lucide-react";
import type { Mp3File, Mp3Tags } from "@/lib/mp3";

export type BulkFieldKey =
  | "filename"
  | "title"
  | "artist"
  | "album"
  | "albumArtist"
  | "composer"
  | "year"
  | "genre"
  | "track"
  | "discnumber"
  | "tag"
  | "comment"
  | "bpm";

const FIELD_OPTIONS: { key: BulkFieldKey; label: string }[] = [
  { key: "filename", label: "Filename" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "genre", label: "Genre" },
  { key: "year", label: "Year" },
  { key: "track", label: "Track" },
  { key: "discnumber", label: "Discnumber" },
  { key: "tag", label: "Tag" },
  { key: "comment", label: "Comment" },
  { key: "bpm", label: "BPM" },
];

type OperationType = "find-replace" | "prefix-suffix" | "insert-remove" | "case" | "trim";

function filenameBase(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function getFieldValue(m: Mp3File, field: BulkFieldKey): string {
  if (field === "filename") return m.renamedBase ?? filenameBase(m.file.name);
  return (m.tags[field as keyof Mp3Tags] as string) || "";
}

export interface BulkFieldEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Mp3File[];
  onApply: (field: BulkFieldKey, changes: Map<string, string>) => void;
}

export function BulkFieldEditDialog({
  open,
  onOpenChange,
  files,
  onApply,
}: BulkFieldEditDialogProps) {
  const [field, setField] = useState<BulkFieldKey>("title");
  const [activeTab, setActiveTab] = useState<OperationType>("find-replace");

  // find/replace
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  // prefix/suffix
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");

  // insert/remove
  const [insertText, setInsertText] = useState("");
  const [insertPos, setInsertPos] = useState("0");
  const [removeStart, setRemoveStart] = useState("0");
  const [removeLength, setRemoveLength] = useState("0");

  // case
  const [caseType, setCaseType] = useState<"upper" | "lower" | "title" | "sentence" | "none">("none");

  // trim
  const [trimSpaces, setTrimSpaces] = useState(true);
  const [collapseSpaces, setCollapseSpaces] = useState(true);
  const [removeSpecial, setRemoveSpecial] = useState(false);

  // Selected rows to affect (default all files supplied)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setSelectedIds(new Set(files.map((f) => f.id)));
  }, [open, files]);

  const transform = (value: string): string => {
    let result = value;
    switch (activeTab) {
      case "find-replace": {
        if (!findText) break;
        try {
          if (useRegex) {
            const flags = caseSensitive ? "g" : "gi";
            result = result.replace(new RegExp(findText, flags), replaceText);
          } else if (caseSensitive) {
            result = result.split(findText).join(replaceText);
          } else {
            const lower = findText.toLowerCase();
            let i = 0;
            while ((i = result.toLowerCase().indexOf(lower, i)) !== -1) {
              result = result.slice(0, i) + replaceText + result.slice(i + findText.length);
              i += replaceText.length;
            }
          }
        } catch {
          /* invalid regex */
        }
        break;
      }
      case "prefix-suffix":
        result = prefix + result + suffix;
        break;
      case "insert-remove": {
        if (insertText) {
          const pos = parseInt(insertPos, 10);
          if (!isNaN(pos)) {
            const p = pos < 0 ? Math.max(0, result.length + pos) : Math.min(result.length, pos);
            result = result.slice(0, p) + insertText + result.slice(p);
          }
        }
        const start = parseInt(removeStart, 10);
        const len = parseInt(removeLength, 10);
        if (!isNaN(start) && !isNaN(len) && len > 0) {
          const s = start < 0 ? Math.max(0, result.length + start) : Math.min(result.length, start);
          result = result.slice(0, s) + result.slice(s + len);
        }
        break;
      }
      case "case":
        if (caseType === "upper") result = result.toUpperCase();
        else if (caseType === "lower") result = result.toLowerCase();
        else if (caseType === "title")
          result = result
            .toLowerCase()
            .split(" ")
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
            .join(" ");
        else if (caseType === "sentence")
          result = result.length ? result[0].toUpperCase() + result.slice(1).toLowerCase() : result;
        break;
      case "trim":
        if (trimSpaces) result = result.trim();
        if (collapseSpaces) result = result.replace(/\s+/g, " ");
        if (removeSpecial) result = result.replace(/[\\/:*?"<>|]/g, "");
        break;
    }
    return result;
  };

  const changes = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of files) {
      if (!selectedIds.has(f.id)) continue;
      const cur = getFieldValue(f, field);
      const next = transform(cur);
      if (next !== cur) m.set(f.id, next);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    files,
    selectedIds,
    field,
    activeTab,
    findText,
    replaceText,
    useRegex,
    caseSensitive,
    prefix,
    suffix,
    insertText,
    insertPos,
    removeStart,
    removeLength,
    caseType,
    trimSpaces,
    collapseSpaces,
    removeSpecial,
  ]);

  const handleApply = () => {
    if (!changes.size) return;
    onApply(field, changes);
    onOpenChange(false);
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(files.map((f) => f.id)) : new Set());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] h-[650px] flex flex-col p-0 gap-0 overflow-hidden bg-background border border-border">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center gap-2">
          <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center">
            <Wand2 className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle className="text-base font-semibold">Bulk Edit Field</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Find & replace or transform values across many files for any column.
            </p>
          </div>
        </DialogHeader>

        <div className="p-4 border-b border-border flex items-center gap-3 bg-sidebar/10">
          <Label className="text-xs text-muted-foreground">Target field</Label>
          <select
            value={field}
            onChange={(e) => setField(e.currentTarget.value as BulkFieldKey)}
            className="h-8 w-48 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            {FIELD_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === files.length && files.length > 0}
                onChange={(e) => toggleAll(e.currentTarget.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>
                Apply to {selectedIds.size} of {files.length} files
              </span>
            </label>
          </div>
        </div>

        <div className="border-b border-border bg-sidebar/10">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as OperationType)} className="w-full">
            <TabsList className="w-full justify-start rounded-none h-10 bg-transparent border-b-0 px-2 gap-1">
              <TabsTrigger value="find-replace" className="text-xs h-8 data-[state=active]:bg-background/80">
                <Search className="h-3 w-3 mr-1.5" /> Find & Replace
              </TabsTrigger>
              <TabsTrigger value="prefix-suffix" className="text-xs h-8 data-[state=active]:bg-background/80">
                <Plus className="h-3 w-3 mr-1.5" /> Prefix/Suffix
              </TabsTrigger>
              <TabsTrigger value="insert-remove" className="text-xs h-8 data-[state=active]:bg-background/80">
                <Scissors className="h-3 w-3 mr-1.5" /> Insert/Remove
              </TabsTrigger>
              <TabsTrigger value="case" className="text-xs h-8 data-[state=active]:bg-background/80">
                <CaseSensitive className="h-3 w-3 mr-1.5" /> Case
              </TabsTrigger>
              <TabsTrigger value="trim" className="text-xs h-8 data-[state=active]:bg-background/80">
                <Sparkles className="h-3 w-3 mr-1.5" /> Trim/Clean
              </TabsTrigger>
            </TabsList>
            <div className="p-4 bg-background">
              <TabsContent value="find-replace" className="mt-0 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Find Text</Label>
                    <Input value={findText} onChange={(e) => setFindText(e.target.value)} className="h-8 text-xs" placeholder="e.g. feat" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Replace With</Label>
                    <Input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} className="h-8 text-xs" placeholder="e.g. ft." />
                  </div>
                </div>
                <div className="flex gap-4 items-center pt-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                    <span>Use Regular Expressions</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                    <span>Case Sensitive</span>
                  </label>
                </div>
              </TabsContent>

              <TabsContent value="prefix-suffix" className="mt-0 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Add Prefix</Label>
                    <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Add Suffix</Label>
                    <Input value={suffix} onChange={(e) => setSuffix(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="insert-remove" className="mt-0 space-y-3">
                <div className="grid grid-cols-2 gap-3 border-b border-border pb-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Insert Text</Label>
                    <Input value={insertText} onChange={(e) => setInsertText(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">At Position (negative = from end)</Label>
                    <Input type="number" value={insertPos} onChange={(e) => setInsertPos(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Remove from Position</Label>
                    <Input type="number" value={removeStart} onChange={(e) => setRemoveStart(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Number of Characters</Label>
                    <Input type="number" min="0" value={removeLength} onChange={(e) => setRemoveLength(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="case" className="mt-0">
                <RadioGroup value={caseType} onValueChange={(v) => setCaseType(v as "upper" | "lower" | "title" | "sentence" | "none")} className="grid grid-cols-2 gap-2">
                  {[
                    { v: "none", l: "No Case Change" },
                    { v: "upper", l: "UPPERCASE" },
                    { v: "lower", l: "lowercase" },
                    { v: "title", l: "Title Case" },
                    { v: "sentence", l: "Sentence case" },
                  ].map((o) => (
                    <label key={o.v} className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                      <RadioGroupItem value={o.v} />
                      <span className="text-xs">{o.l}</span>
                    </label>
                  ))}
                </RadioGroup>
              </TabsContent>

              <TabsContent value="trim" className="mt-0 space-y-2">
                <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                  <input type="checkbox" checked={trimSpaces} onChange={(e) => setTrimSpaces(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                  <div className="text-left">
                    <p className="text-xs font-medium">Trim Whitespace</p>
                    <p className="text-[10px] text-muted-foreground">Remove leading and trailing spaces.</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                  <input type="checkbox" checked={collapseSpaces} onChange={(e) => setCollapseSpaces(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                  <div className="text-left">
                    <p className="text-xs font-medium">Collapse Multiple Spaces</p>
                    <p className="text-[10px] text-muted-foreground">Replace runs of whitespace with a single space.</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                  <input type="checkbox" checked={removeSpecial} onChange={(e) => setRemoveSpecial(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                  <div className="text-left">
                    <p className="text-xs font-medium">Remove Invalid Path Characters</p>
                    <p className="text-[10px] text-muted-foreground">Strip \ / : * ? &quot; &lt; &gt; |</p>
                  </div>
                </label>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-sidebar/5">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-sidebar/20">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</span>
            <span className="text-[10px] text-muted-foreground">{changes.size} of {selectedIds.size} will change</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-4">
              {changes.size === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">No changes for the current rules.</div>
              ) : (
                <div className="space-y-1">
                  {Array.from(changes.entries()).slice(0, 200).map(([id, next]) => {
                    const f = files.find((x) => x.id === id);
                    if (!f) return null;
                    const cur = getFieldValue(f, field);
                    return (
                      <div key={id} className="flex items-center gap-3 py-1.5 border-b border-border/40 text-xs">
                        <span className="flex-1 truncate font-mono text-muted-foreground" title={cur}>{cur || <span className="italic">&lt;empty&gt;</span>}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate font-mono text-primary font-medium" title={next}>{next || <span className="italic">&lt;empty&gt;</span>}</span>
                      </div>
                    );
                  })}
                  {changes.size > 200 && (
                    <div className="text-center py-2 text-[10px] text-muted-foreground">…and {changes.size - 200} more</div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="p-4 border-t border-border flex items-center justify-between">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {changes.size > 0 ? (
              <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-0 h-5">
                {changes.size} file{changes.size > 1 ? "s" : ""} will be updated
              </Badge>
            ) : (
              <span>No modifications to apply</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={changes.size === 0} className="h-8 text-xs">
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
