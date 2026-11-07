import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONVERTER_FIELDS, type ConverterTagKey } from "@/lib/tag-converter";
import {
  filenameExtractionError,
  type FilenameExtractionMode,
  type FilenameExtractionRule,
} from "@/lib/filename-extraction";

const selectClass =
  "h-8 w-full border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary";
const inputClass = "h-8 text-xs focus-visible:ring-0 focus:border-primary";

export function FilenameExtractionControls({
  rule,
  onChange,
  target,
  onTargetChange,
}: {
  rule: FilenameExtractionRule;
  onChange: (rule: FilenameExtractionRule) => void;
  target: ConverterTagKey;
  onTargetChange: (target: ConverterTagKey) => void;
}) {
  const characters = rule.mode === "characters";
  const numbers = rule.mode === "before-number" || rule.mode === "after-number";
  const error = filenameExtractionError(rule);
  return (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="filename-extract-mode" className="text-[11px] text-muted-foreground">
            Extract
          </Label>
          <select
            id="filename-extract-mode"
            value={rule.mode}
            onChange={(event) =>
              onChange({ ...rule, mode: event.currentTarget.value as FilenameExtractionMode })
            }
            className={selectClass}
          >
            <option value="before-separator">Text before separator</option>
            <option value="after-separator">Text after separator</option>
            <option value="part">Part number (split by separator)</option>
            <option value="before-number">Text before number</option>
            <option value="after-number">Text after number</option>
            <option value="characters">Character positions</option>
          </select>
        </div>
        {!characters && !numbers && (
          <div className="space-y-1">
            <Label
              htmlFor="filename-extract-separator"
              className="text-[11px] text-muted-foreground"
            >
              Separator (type any symbol or text)
            </Label>
            <Input
              id="filename-extract-separator"
              list="filename-extract-separators"
              value={rule.separator}
              onChange={(event) => onChange({ ...rule, separator: event.target.value })}
              maxLength={64}
              spellCheck={false}
              className={inputClass}
            />
            <datalist id="filename-extract-separators">
              {["-", " - ", "_", "|", "::", "#", ".", "[", "(", "–", "—"].map((separator) => (
                <option key={separator} value={separator} />
              ))}
            </datalist>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="filename-extract-target" className="text-[11px] text-muted-foreground">
            Write to tag
          </Label>
          <select
            id="filename-extract-target"
            value={target}
            onChange={(event) => onTargetChange(event.currentTarget.value as ConverterTagKey)}
            className={selectClass}
          >
            {CONVERTER_FIELDS.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
        {characters ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="filename-extract-start" className="text-[11px] text-muted-foreground">
                Start character (1 = first)
              </Label>
              <Input
                id="filename-extract-start"
                type="number"
                min={1}
                step={1}
                value={rule.start || ""}
                onChange={(event) => onChange({ ...rule, start: Number(event.target.value) })}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filename-extract-end" className="text-[11px] text-muted-foreground">
                End character (inclusive; blank = end)
              </Label>
              <Input
                id="filename-extract-end"
                type="number"
                min={rule.start || 1}
                step={1}
                value={rule.end ?? ""}
                onChange={(event) =>
                  onChange({
                    ...rule,
                    end: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
                className={inputClass}
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label
                htmlFor="filename-extract-position"
                className="text-[11px] text-muted-foreground"
              >
                {rule.mode === "part"
                  ? "Part number (1 = first)"
                  : numbers
                    ? "Number occurrence (1 = first)"
                    : "Separator occurrence (1 = first)"}
              </Label>
              <Input
                id="filename-extract-position"
                type="number"
                min={1}
                step={1}
                value={rule.position || ""}
                onChange={(event) => onChange({ ...rule, position: Number(event.target.value) })}
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={rule.fromEnd}
                onChange={(event) => onChange({ ...rule, fromEnd: event.currentTarget.checked })}
                className="h-3.5 w-3.5 accent-primary"
              />
              Count from end
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rule.trim}
            onChange={(event) => onChange({ ...rule, trim: event.currentTarget.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          Trim spaces
        </label>
        {numbers && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={rule.trimNumberSeparators}
              onChange={(event) =>
                onChange({ ...rule, trimNumberSeparators: event.currentTarget.checked })
              }
              className="h-3.5 w-3.5 accent-primary"
            />
            Remove leftover separators (-, _, etc.)
          </label>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The extension is excluded. Positions start at 1. Empty results and missing
        separators/numbers are skipped. Apply stages the tag edits; use Save to write them.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
