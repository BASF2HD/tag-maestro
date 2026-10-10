import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown } from "@/components/icons";

export const KEEP_TAG_VALUE = "<keep>";

export function TagFieldCombo({
  value,
  options,
  onChange,
  disabled,
  multiline = false,
  fieldLabel = "field",
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  multiline?: boolean;
  fieldLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);
  const isMulti = value === KEEP_TAG_VALUE;

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
      {multiline ? (
        <Textarea
          aria-label={fieldLabel}
          disabled={disabled}
          value={isMulti ? "" : value}
          placeholder={isMulti ? "<keep>" : ""}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[32px] rounded-[1px] border-border bg-white px-1.5 py-0.5 pr-6 text-[11px] leading-4 text-foreground shadow-none focus-visible:bg-white focus-visible:ring-0 focus-visible:border-primary dark:bg-background dark:focus-visible:bg-background"
        />
      ) : (
        <Input
          aria-label={fieldLabel}
          disabled={disabled}
          value={isMulti ? "" : value}
          placeholder={isMulti ? "<keep>" : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-[22px] rounded-[1px] border-border bg-white px-1.5 py-0 pr-6 text-[11px] leading-none text-foreground shadow-none focus-visible:bg-white focus-visible:ring-0 focus-visible:border-primary dark:bg-background dark:focus-visible:bg-background"
        />
      )}
      <button
        type="button"
        disabled={disabled}
        className="absolute right-0.5 top-1/2 grid h-[18px] w-5 -translate-y-1/2 place-items-center rounded-sm text-foreground hover:bg-accent hover:text-foreground disabled:opacity-100"
        aria-label={`Choose ${fieldLabel} value`}
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
              onChange(KEEP_TAG_VALUE);
              setOpen(false);
            }}
          >
            <span title="Leave each selected song’s existing value unchanged">&lt;keep&gt;</span>
          </button>
          <button
            type="button"
            className="block h-[18px] w-full px-1.5 py-0 text-left text-[10.5px] italic leading-[18px] [color:GrayText] hover:[background:Highlight] hover:[color:HighlightText] focus:[background:Highlight] focus:[color:HighlightText] focus:outline-none"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <span title="Clear this field on all selected songs">&lt;blank&gt;</span>
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
            <div className="h-[18px] px-1.5 py-0 text-[10.5px] italic leading-[18px] [color:GrayText]">
              No values in selection
            </div>
          )}
        </div>
      )}
    </div>
  );
}
