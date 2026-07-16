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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  FolderEdit,
  Search,
  ArrowRight,
  Type,
  Plus,
  Minus,
  Scissors,
  CaseSensitive,
  Sparkles,
} from "lucide-react";

export interface FolderRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Map<string, string[]>;
  onApply: (renames: Map<string, string>) => void;
}

type OperationType = "find-replace" | "prefix-suffix" | "insert-remove" | "case" | "trim";

export function FolderRenameDialog({
  open,
  onOpenChange,
  folders,
  onApply,
}: FolderRenameDialogProps) {
  // Available folder names list
  const allFolderNames = useMemo(() => Array.from(folders.keys()).sort(), [folders]);

  // Selected folders state (keys in the folders map)
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  // Initialize selectedFolders to all folders when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedFolders(new Set(allFolderNames));
    }
  }, [open, allFolderNames]);

  // Active operation tab
  const [activeTab, setActiveTab] = useState<OperationType>("find-replace");

  // Operation parameters
  // 1. Find & Replace
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  // 2. Prefix & Suffix
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");

  // 3. Insert & Remove
  const [insertText, setInsertText] = useState("");
  const [insertPos, setInsertPos] = useState("0");
  const [removeStart, setRemoveStart] = useState("0");
  const [removeLength, setRemoveLength] = useState("0");

  // 4. Change Case
  const [caseType, setCaseType] = useState<"upper" | "lower" | "title" | "sentence" | "none">("none");

  // 5. Trim
  const [trimSpaces, setTrimSpaces] = useState(true);
  const [collapseSpaces, setCollapseSpaces] = useState(true);
  const [removeSpecial, setRemoveSpecial] = useState(false);

  // Filter folder list sidebar
  const [sidebarFilter, setSidebarFilter] = useState("");

  const filteredSidebarFolders = useMemo(() => {
    return allFolderNames.filter((name) =>
      name.toLowerCase().includes(sidebarFilter.toLowerCase())
    );
  }, [allFolderNames, sidebarFilter]);

  // Apply transformations helper
  const transformName = (name: string): string => {
    let result = name;

    switch (activeTab) {
      case "find-replace": {
        if (!findText) break;
        try {
          if (useRegex) {
            const flags = caseSensitive ? "g" : "gi";
            const regex = new RegExp(findText, flags);
            result = result.replace(regex, replaceText);
          } else {
            if (caseSensitive) {
              result = result.split(findText).join(replaceText);
            } else {
              // Case-insensitive exact text search & replace
              const findLower = findText.toLowerCase();
              let i = 0;
              while ((i = result.toLowerCase().indexOf(findLower, i)) !== -1) {
                result = result.substring(0, i) + replaceText + result.substring(i + findText.length);
                i += replaceText.length;
              }
            }
          }
        } catch (e) {
          // invalid regex, ignore
        }
        break;
      }
      case "prefix-suffix": {
        result = prefix + result + suffix;
        break;
      }
      case "insert-remove": {
        // Insert
        if (insertText) {
          const pos = parseInt(insertPos, 10);
          if (!isNaN(pos)) {
            const actualPos = pos < 0 ? Math.max(0, result.length + pos) : Math.min(result.length, pos);
            result = result.slice(0, actualPos) + insertText + result.slice(actualPos);
          }
        }
        // Remove
        const start = parseInt(removeStart, 10);
        const len = parseInt(removeLength, 10);
        if (!isNaN(start) && !isNaN(len) && len > 0) {
          const actualStart = start < 0 ? Math.max(0, result.length + start) : Math.min(result.length, start);
          result = result.slice(0, actualStart) + result.slice(actualStart + len);
        }
        break;
      }
      case "case": {
        if (caseType === "upper") {
          result = result.toUpperCase();
        } else if (caseType === "lower") {
          result = result.toLowerCase();
        } else if (caseType === "title") {
          result = result
            .toLowerCase()
            .split(" ")
            .map((w) => w.charAt(0).toUpperCase() + w.substring(1))
            .join(" ");
        } else if (caseType === "sentence") {
          result = result.toLowerCase();
          if (result.length > 0) {
            result = result.charAt(0).toUpperCase() + result.substring(1);
          }
        }
        break;
      }
      case "trim": {
        if (trimSpaces) {
          result = result.trim();
        }
        if (collapseSpaces) {
          result = result.replace(/\s+/g, " ");
        }
        if (removeSpecial) {
          // Remove standard Windows/Unix invalid path characters \ / : * ? " < > |
          result = result.replace(/[\\/:*?"<>|]/g, "");
        }
        break;
      }
    }

    return result;
  };

  // Generate mapping of: original -> new for ALL folders
  const renamesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const name of allFolderNames) {
      if (selectedFolders.has(name)) {
        const next = transformName(name);
        if (next !== name) {
          map.set(name, next);
        }
      }
    }
    return map;
  }, [allFolderNames, selectedFolders, activeTab, findText, replaceText, useRegex, caseSensitive, prefix, suffix, insertText, insertPos, removeStart, removeLength, caseType, trimSpaces, collapseSpaces, removeSpecial]);

  const handleSelectAll = () => {
    setSelectedFolders(new Set(allFolderNames));
  };

  const handleDeselectAll = () => {
    setSelectedFolders(new Set());
  };

  const handleToggleFolder = (name: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleApplyClick = () => {
    if (renamesMap.size === 0) return;
    onApply(renamesMap);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] h-[650px] flex flex-col p-0 gap-0 overflow-hidden bg-background border border-border">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center gap-2">
          <div className="h-8 w-8 rounded bg-primary/10 text-primary flex items-center justify-center">
            <FolderEdit className="h-4 w-4" />
          </div>
          <div>
            <DialogTitle className="text-base font-semibold">Bulk Rename Folder Names</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Perform batch adjustments on the album folder names. These changes will apply on folder export.
            </p>
          </div>
        </DialogHeader>

        {/* Workspace split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel: list of folders */}
          <div className="w-[280px] border-r border-border flex flex-col bg-sidebar/20">
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter folders..."
                  value={sidebarFilter}
                  onChange={(e) => setSidebarFilter(e.target.value)}
                  className="h-8 pl-8 text-xs bg-background/50"
                />
              </div>
              <div className="flex gap-2 justify-between">
                <Button variant="outline" className="text-[10px] flex-1 h-6 py-0" onClick={handleSelectAll}>
                  Select All
                </Button>
                <Button variant="outline" className="text-[10px] flex-1 h-6 py-0" onClick={handleDeselectAll}>
                  Deselect All
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {filteredSidebarFolders.map((name) => {
                  const isChecked = selectedFolders.has(name);
                  const filesCount = folders.get(name)?.length || 0;
                  return (
                    <div
                      key={name}
                      onClick={() => handleToggleFolder(name)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent/40 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        tabIndex={-1}
                        className="pointer-events-none h-3.5 w-3.5 accent-primary"
                      />
                      <span className="truncate flex-1" title={name}>
                        {name || <span className="italic text-muted-foreground">&lt;Empty&gt;</span>}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 h-4 font-mono">
                        {filesCount}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right panel: actions and preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-border bg-sidebar/10">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as OperationType)}
                className="w-full"
              >
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

                {/* Tab content wrapper for padding */}
                <div className="p-4 bg-background">
                  <TabsContent value="find-replace" className="mt-0 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="find" className="text-[11px] text-muted-foreground">Find Text</Label>
                        <Input
                          id="find"
                          value={findText}
                          onChange={(e) => setFindText(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="e.g. Album"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="replace" className="text-[11px] text-muted-foreground">Replace With</Label>
                        <Input
                          id="replace"
                          value={replaceText}
                          onChange={(e) => setReplaceText(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="e.g. LP"
                        />
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
                        <Label htmlFor="prefix" className="text-[11px] text-muted-foreground">Add Prefix</Label>
                        <Input
                          id="prefix"
                          value={prefix}
                          onChange={(e) => setPrefix(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="e.g. 2026 - "
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="suffix" className="text-[11px] text-muted-foreground">Add Suffix</Label>
                        <Input
                          id="suffix"
                          value={suffix}
                          onChange={(e) => setSuffix(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="e.g. [FLAC]"
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="insert-remove" className="mt-0 space-y-3">
                    <div className="grid grid-cols-2 gap-3 border-b border-border pb-3">
                      <div className="space-y-1">
                        <Label htmlFor="insert" className="text-[11px] text-muted-foreground">Insert Text</Label>
                        <Input
                          id="insert"
                          value={insertText}
                          onChange={(e) => setInsertText(e.target.value)}
                          className="h-8 text-xs"
                          placeholder="e.g. - "
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="insert-pos" className="text-[11px] text-muted-foreground">At Position (0-based index, negative from end)</Label>
                        <Input
                          id="insert-pos"
                          type="number"
                          value={insertPos}
                          onChange={(e) => setInsertPos(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="remove-start" className="text-[11px] text-muted-foreground">Remove from Position</Label>
                        <Input
                          id="remove-start"
                          type="number"
                          value={removeStart}
                          onChange={(e) => setRemoveStart(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="remove-len" className="text-[11px] text-muted-foreground">Number of Characters</Label>
                        <Input
                          id="remove-len"
                          type="number"
                          min="0"
                          value={removeLength}
                          onChange={(e) => setRemoveLength(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="case" className="mt-0">
                    <RadioGroup
                      value={caseType}
                      onValueChange={(v) => setCaseType(v as any)}
                      className="grid grid-cols-2 gap-2"
                    >
                      <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                        <RadioGroupItem value="none" />
                        <span className="text-xs">No Case Change</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                        <RadioGroupItem value="upper" />
                        <span className="text-xs">UPPERCASE</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                        <RadioGroupItem value="lower" />
                        <span className="text-xs">lowercase</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                        <RadioGroupItem value="title" />
                        <span className="text-xs">Title Case</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                        <RadioGroupItem value="sentence" />
                        <span className="text-xs">Sentence case</span>
                      </label>
                    </RadioGroup>
                  </TabsContent>

                  <TabsContent value="trim" className="mt-0 space-y-2">
                    <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                      <input type="checkbox" checked={trimSpaces} onChange={(e) => setTrimSpaces(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                      <div className="text-left">
                        <p className="text-xs font-medium">Trim Whitespace</p>
                        <p className="text-[10px] text-muted-foreground">Remove spaces from the beginning and end.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                      <input type="checkbox" checked={collapseSpaces} onChange={(e) => setCollapseSpaces(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                      <div className="text-left">
                        <p className="text-xs font-medium">Collapse Multiple Spaces</p>
                        <p className="text-[10px] text-muted-foreground">Replace multiple consecutive spaces with a single space.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-2 p-2 rounded border border-border bg-card hover:bg-accent/40 cursor-pointer">
                      <input type="checkbox" checked={removeSpecial} onChange={(e) => setRemoveSpecial(e.currentTarget.checked)} className="h-3.5 w-3.5 accent-primary" />
                      <div className="text-left">
                        <p className="text-xs font-medium">Remove Invalid Path Characters</p>
                        <p className="text-[10px] text-muted-foreground">Remove invalid folder characters (e.g. \ / : * ? &quot; &lt; &gt; |).</p>
                      </div>
                    </label>
                  </TabsContent>
                </div>
              </Tabs>
            </div>

            {/* Live Preview section */}
            <div className="flex-1 flex flex-col min-h-0 bg-sidebar/5">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-sidebar/20">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live Preview</span>
                <span className="text-[10px] text-muted-foreground">
                  {selectedFolders.size} of {allFolderNames.length} folders selected
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {selectedFolders.size === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      Select folder names on the left sidebar to see preview
                    </div>
                  ) : renamesMap.size === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      No changes matching the current rules
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {Array.from(renamesMap.entries()).map(([orig, next]) => (
                        <div
                          key={orig}
                          className="flex items-center gap-3 py-1.5 border-b border-border/40 text-xs"
                        >
                          <span className="flex-1 truncate font-mono text-muted-foreground" title={orig}>{orig}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate font-mono text-primary font-medium" title={next}>{next}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border flex items-center justify-between">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {renamesMap.size > 0 ? (
              <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-0 h-5">
                {renamesMap.size} folder{renamesMap.size > 1 ? "s" : ""} will be renamed
              </Badge>
            ) : (
              <span>No modifications to apply</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              Cancel
            </Button>
            <Button onClick={handleApplyClick} disabled={renamesMap.size === 0} className="h-8 text-xs">
              Apply Renames
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
