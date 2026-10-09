import { useState, type CSSProperties } from "react";

export function EditableTableCell({
  value,
  onChange,
  style,
  dirty,
}: {
  value: string;
  onChange: (value: string) => void;
  style: CSSProperties;
  dirty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <td
      style={style}
      className="px-1 py-px"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <div className="flex items-center">
        {dirty && (
          <span className="text-primary ml-0.5 mr-1 shrink-0 text-[10px]" title="Modified">
            ●
          </span>
        )}
        {editing ? (
          <input
            autoFocus
            aria-label="Edit cell"
            className="h-5 w-full truncate rounded-none bg-transparent px-1.5 py-0 text-[11px] leading-none text-slate-950 outline-none focus:bg-white focus:ring-1 focus:ring-primary dark:text-foreground dark:focus:bg-background"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter" || event.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span
            className="block h-5 w-full truncate px-1.5 text-[11px] leading-5 text-slate-950 dark:text-foreground"
            title={`${value || "Empty"} — double-click to edit`}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "F2") {
                event.preventDefault();
                setEditing(true);
              }
            }}
          >
            {value || "\u00a0"}
          </span>
        )}
      </div>
    </td>
  );
}
