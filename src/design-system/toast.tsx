import { t } from "@/lib/i18n";
import { create } from "zustand";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { IconButton } from "./primitives";

interface Toast {
  id: number;
  tone: "error" | "info";
  title: string;
  detail?: string;
}

const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));
let seq = 0;

function push(t: Omit<Toast, "id">) {
  const id = ++seq;
  useToasts.setState((s) => ({
    items: [...s.items.filter((x) => x.title !== t.title), { ...t, id }].slice(
      -4,
    ),
  }));
  setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 3500);
}

function dismiss(id: number) {
  useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== id) }));
}

export const toast = {
  error: (title: string, detail?: string) =>
    push({ tone: "error", title, detail }),
  info: (title: string, detail?: string) =>
    push({ tone: "info", title, detail }),
};

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <div
      role="region"
      aria-label={t("Notifications")}
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === "error" ? "alert" : "status"}
          className="anim-pop pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-pop"
        >
          {item.tone === "error" ? (
            <CircleAlert size={15} className="mt-0.5 shrink-0 text-err" />
          ) : (
            <CircleCheck size={15} className="mt-0.5 shrink-0 text-ok" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{item.title}</div>
            {item.detail && (
              <div className="mt-0.5 text-[var(--fs-sm)] break-words text-fg-2">
                {item.detail}
              </div>
            )}
          </div>
          <IconButton
            label={t("Fermer")}
            size="sm"
            onClick={() => dismiss(item.id)}
          >
            <X size={13} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
