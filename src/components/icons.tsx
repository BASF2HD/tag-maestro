import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;
type PathDef = {
  d?: string;
  points?: string;
  cx?: number;
  cy?: number;
  r?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rx?: number;
  kind?: "path" | "polyline" | "line" | "circle" | "rect";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
};

function icon(paths: PathDef[]) {
  return function Icon({ className, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        {...props}
      >
        {paths.map((p, i) => {
          if (p.kind === "polyline") return <polyline key={i} points={p.points} />;
          if (p.kind === "line") return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} />;
          if (p.kind === "circle") return <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />;
          if (p.kind === "rect") return <rect key={i} x={p.x} y={p.y} width={p.width} height={p.height} rx={p.rx} />;
          return <path key={i} d={p.d} />;
        })}
      </svg>
    );
  };
}

export const ArrowDown = icon([{ kind: "line", x1: 12, y1: 5, x2: 12, y2: 19 }, { kind: "polyline", points: "19 12 12 19 5 12" }]);
export const ArrowRight = icon([{ kind: "line", x1: 5, y1: 12, x2: 19, y2: 12 }, { kind: "polyline", points: "12 5 19 12 12 19" }]);
export const ArrowUp = icon([{ kind: "line", x1: 12, y1: 19, x2: 12, y2: 5 }, { kind: "polyline", points: "5 12 12 5 19 12" }]);
export const ArrowUpDown = icon([{ kind: "polyline", points: "7 7 12 2 17 7" }, { kind: "line", x1: 12, y1: 2, x2: 12, y2: 22 }, { kind: "polyline", points: "17 17 12 22 7 17" }]);
export const CaseSensitive = icon([{ d: "M4 19 9 5h2l5 14" }, { kind: "line", x1: 6, y1: 14, x2: 14, y2: 14 }, { d: "M18 12h2a2 2 0 0 1 0 4h-2v-8" }]);
export const ChevronDown = icon([{ kind: "polyline", points: "6 9 12 15 18 9" }]);
export const ChevronLeft = icon([{ kind: "polyline", points: "15 18 9 12 15 6" }]);
export const ChevronRight = icon([{ kind: "polyline", points: "9 18 15 12 9 6" }]);
export const ChevronsLeft = icon([{ kind: "polyline", points: "11 17 6 12 11 7" }, { kind: "polyline", points: "18 17 13 12 18 7" }]);
export const ChevronsRight = icon([{ kind: "polyline", points: "6 17 11 12 6 7" }, { kind: "polyline", points: "13 17 18 12 13 7" }]);
export const Download = icon([{ d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }, { kind: "line", x1: 12, y1: 3, x2: 12, y2: 15 }, { kind: "polyline", points: "7 10 12 15 17 10" }]);
export const FileText = icon([{ d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }, { kind: "polyline", points: "14 2 14 8 20 8" }, { kind: "line", x1: 8, y1: 13, x2: 16, y2: 13 }, { kind: "line", x1: 8, y1: 17, x2: 16, y2: 17 }]);
export const FolderEdit = icon([{ d: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v5" }, { d: "M4 19h8" }, { d: "m15 19 5-5 2 2-5 5h-2z" }]);
export const FolderOpen = icon([{ d: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" }, { d: "M3 19l3-8h16l-3 8z" }]);
export const FolderTree = icon([{ d: "M4 4h6v6H4z" }, { d: "M14 14h6v6h-6z" }, { d: "M4 14h6v6H4z" }, { d: "M10 7h2v10h2" }, { kind: "line", x1: 12, y1: 17, x2: 10, y2: 17 }]);
export const Image = icon([{ kind: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 }, { kind: "circle", cx: 8, cy: 10, r: 1.5 }, { kind: "polyline", points: "21 16 16 11 5 19" }]);
export const Loader2 = icon([{ d: "M21 12a9 9 0 0 1-9 9" }, { d: "M3 12a9 9 0 0 1 9-9" }]);
export const Minus = icon([{ kind: "line", x1: 5, y1: 12, x2: 19, y2: 12 }]);
export const Moon = icon([{ d: "M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z" }]);
export const MoreVertical = icon([{ kind: "circle", cx: 12, cy: 5, r: 1 }, { kind: "circle", cx: 12, cy: 12, r: 1 }, { kind: "circle", cx: 12, cy: 19, r: 1 }]);
export const Music4 = icon([{ d: "M9 18V5l12-2v13" }, { kind: "circle", cx: 6, cy: 18, r: 3 }, { kind: "circle", cx: 18, cy: 16, r: 3 }]);
export const Plus = icon([{ kind: "line", x1: 12, y1: 5, x2: 12, y2: 19 }, { kind: "line", x1: 5, y1: 12, x2: 19, y2: 12 }]);
export const Save = icon([{ d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" }, { kind: "polyline", points: "17 21 17 13 7 13 7 21" }, { kind: "polyline", points: "7 3 7 8 15 8" }]);
export const Scissors = icon([{ kind: "circle", cx: 6, cy: 6, r: 3 }, { kind: "circle", cx: 6, cy: 18, r: 3 }, { kind: "line", x1: 20, y1: 4, x2: 8.5, y2: 15.5 }, { kind: "line", x1: 14, y1: 14, x2: 20, y2: 20 }, { kind: "line", x1: 8.5, y1: 8.5, x2: 12, y2: 12 }]);
export const Search = icon([{ kind: "circle", cx: 11, cy: 11, r: 8 }, { kind: "line", x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]);
export const Sparkles = icon([{ d: "M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" }, { d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" }, { d: "M5 3l.8 2.2L8 6l-2.2.8L5 9l-.8-2.2L2 6l2.2-.8z" }]);
export const Sun = icon([{ kind: "circle", cx: 12, cy: 12, r: 4 }, { kind: "line", x1: 12, y1: 2, x2: 12, y2: 4 }, { kind: "line", x1: 12, y1: 20, x2: 12, y2: 22 }, { kind: "line", x1: 4.93, y1: 4.93, x2: 6.34, y2: 6.34 }, { kind: "line", x1: 17.66, y1: 17.66, x2: 19.07, y2: 19.07 }, { kind: "line", x1: 2, y1: 12, x2: 4, y2: 12 }, { kind: "line", x1: 20, y1: 12, x2: 22, y2: 12 }, { kind: "line", x1: 4.93, y1: 19.07, x2: 6.34, y2: 17.66 }, { kind: "line", x1: 17.66, y1: 6.34, x2: 19.07, y2: 4.93 }]);
export const Trash2 = icon([{ kind: "polyline", points: "3 6 5 6 21 6" }, { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }, { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }, { kind: "line", x1: 10, y1: 11, x2: 10, y2: 17 }, { kind: "line", x1: 14, y1: 11, x2: 14, y2: 17 }]);
export const Type = icon([{ kind: "polyline", points: "4 7 4 4 20 4 20 7" }, { kind: "line", x1: 9, y1: 20, x2: 15, y2: 20 }, { kind: "line", x1: 12, y1: 4, x2: 12, y2: 20 }]);
export const Upload = icon([{ d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }, { kind: "line", x1: 12, y1: 15, x2: 12, y2: 3 }, { kind: "polyline", points: "17 8 12 3 7 8" }]);
export const Wand2 = icon([{ kind: "line", x1: 15, y1: 4, x2: 20, y2: 9 }, { kind: "line", x1: 4, y1: 20, x2: 14, y2: 10 }, { kind: "line", x1: 13, y1: 5, x2: 19, y2: 11 }, { d: "M5 6l1-2 1 2 2 1-2 1-1 2-1-2-2-1z" }]);
