import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";
type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(items);
}

function addToast(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, kind === "error" ? 5200 : 3200);
  return id;
}

export const toast = {
  success: (message: string) => addToast("success", message),
  error: (message: string) => addToast("error", message),
  info: (message: string) => addToast("info", message),
};

export function Toaster() {
  const [visible, setVisible] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setVisible);
    return () => {
      listeners.delete(setVisible);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2">
      {visible.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto rounded-sm border bg-background px-3 py-2 text-xs text-foreground shadow-none ${
            item.kind === "success"
              ? "border-primary/45"
              : item.kind === "error"
                ? "border-destructive/60"
                : "border-border"
          }`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
