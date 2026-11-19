import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { errorMessage } from "@/lib/ipc";

type Status =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "downloading"
  | "installing"
  | "error";

interface UpdatesState {
  status: Status;
  version: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
  checkedAt: number | null;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let pending: Update | null = null;

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  checkedAt: null,
  dialogOpen: false,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),

  check: async () => {
    const busy = get().status;
    if (busy === "checking" || busy === "downloading" || busy === "installing")
      return;
    if (!inTauri) {
      set({ status: "uptodate", checkedAt: Date.now() });
      return;
    }
    set({ status: "checking", error: null });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      pending = update;
      set(
        update
          ? {
              status: "available",
              version: update.version,
              notes: update.body?.trim() || null,
              checkedAt: Date.now(),
            }
          : { status: "uptodate", checkedAt: Date.now() },
      );
    } catch (e) {
      set({ status: "error", error: errorMessage(e), checkedAt: Date.now() });
    }
  },

  install: async () => {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ status: "downloading", progress: 0, error: null });
    try {
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          set({ progress: total ? received / total : null });
        } else set({ status: "installing", progress: 1 });
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      set({ status: "error", error: errorMessage(e) });
    }
  },
}));

export function startUpdateChecks(enabled: () => boolean) {
  const run = () => enabled() && void useUpdates.getState().check();
  window.setTimeout(run, 8_000);
  window.setInterval(run, 6 * 3_600_000);
}
