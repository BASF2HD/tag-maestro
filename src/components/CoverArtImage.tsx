import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** The original embedded image bytes are used for both views; no thumbnail conversion. */
export function CoverArtImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`${className || ""} cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        role="button"
        tabIndex={0}
        aria-label="Open full-resolution cover art"
        title="Double-click to view full-resolution artwork"
        onDoubleClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <CoverArtViewer src={src} open={open} onOpenChange={setOpen} />
    </>
  );
}

function CoverArtViewer({
  src,
  open,
  onOpenChange,
}: {
  src: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [actualSize, setActualSize] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setActualSize(false);
    setDimensions({ width: 0, height: 0 });
  }, [src, open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-3 p-4">
        <DialogHeader className="pr-8">
          <DialogTitle>Full-resolution cover art</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span role="status" className="mr-auto">
            {dimensions.width
              ? `${dimensions.width} × ${dimensions.height} pixels · ${actualSize ? "100% original size" : "Fit to window"}`
              : "Loading original image…"}
          </span>
          <Button
            size="sm"
            variant={actualSize ? "outline" : "default"}
            onClick={() => setActualSize(false)}
          >
            Fit to window
          </Button>
          <Button
            size="sm"
            variant={actualSize ? "default" : "outline"}
            onClick={() => setActualSize(true)}
          >
            Actual size (100%)
          </Button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30"
          aria-label="Full-resolution artwork viewport"
        >
          <img
            src={src}
            alt="Full-resolution cover artwork"
            draggable={false}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            className={actualSize ? "block max-w-none" : "h-full w-full object-contain"}
            style={
              actualSize && dimensions.width
                ? { width: dimensions.width, height: dimensions.height }
                : undefined
            }
          />
        </div>
        <div className="flex justify-end">
          <Button ref={close} size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Close image
          </Button>
        </div>
      </DialogContent>
    </Dialog>,
    document.body,
  );
}
