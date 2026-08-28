import * as React from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { GripHorizontal, X } from "@/components/icons";

type DialogContextValue = {
  onOpenChange?: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue>({});

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return <DialogContext.Provider value={{ onOpenChange }}>{children}</DialogContext.Provider>;
}

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, style, ...props }, ref) => {
    const { onOpenChange } = React.useContext(DialogContext);
    const contentRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      baseLeft: number;
      baseTop: number;
      width: number;
      height: number;
    } | null>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
      function move(event: PointerEvent) {
        const drag = dragRef.current;
        if (!drag) return;
        const maxX = window.innerWidth - 16 - drag.width - drag.baseLeft;
        const maxY = window.innerHeight - 16 - drag.height - drag.baseTop;
        const nextX = Math.min(
          Math.max(drag.originX + event.clientX - drag.startX, 16 - drag.baseLeft),
          Math.max(16 - drag.baseLeft, maxX),
        );
        const nextY = Math.min(
          Math.max(drag.originY + event.clientY - drag.startY, 16 - drag.baseTop),
          Math.max(16 - drag.baseTop, maxY),
        );
        setOffset({ x: nextX, y: nextY });
      }
      function stop() {
        dragRef.current = null;
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      return () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
    }, []);

    function startDrag(event: React.PointerEvent<HTMLDivElement>) {
      const handle = (event.target as HTMLElement).closest("[data-dialog-drag-handle]");
      if (!handle || (event.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      const element = contentRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
        baseLeft: rect.left - offset.x,
        baseTop: rect.top - offset.y,
        width: rect.width,
        height: rect.height,
      };
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
    }

    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
        <div className="absolute inset-0" onClick={() => onOpenChange?.(false)} />
        <div
          ref={(element) => {
            contentRef.current = element;
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
          role="dialog"
          aria-modal="true"
          className={cn(
            "relative z-10 w-full rounded-lg border bg-background shadow-lg",
            className,
          )}
          style={{ ...style, transform: `translate(${offset.x}px, ${offset.y}px)` }}
          onPointerDown={startDrag}
          {...props}
        >
          <div
            data-dialog-drag-handle
            aria-hidden="true"
            className="absolute inset-x-0 top-0 z-10 flex h-4 cursor-grab items-center justify-center text-muted-foreground/70 active:cursor-grabbing"
          >
            <GripHorizontal className="h-3.5 w-7" />
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            title="Close dialog"
            className="absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            onClick={() => onOpenChange?.(false)}
          >
            <X className="h-4 w-4" />
          </button>
          {children}
        </div>
      </div>
    );
  },
);
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-drag-handle
    className={cn("flex w-full cursor-grab touch-none select-none flex-col space-y-1.5 text-center active:cursor-grabbing sm:text-left", className)}
    {...props}
  />
);

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
  ),
);
DialogTitle.displayName = "DialogTitle";

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle };
