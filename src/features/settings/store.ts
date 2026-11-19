import { create } from "zustand";
import { errorMessage, ipc, type Settings } from "@/lib/ipc";
import { defaultSettings } from "@/lib/mock-backend";
import { toast } from "@/design-system/toast";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  loaded: false,
  load: async () => {
    const settings = await ipc.getSettings();
    set({ settings, loaded: true });
  },
  update: async (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    try {
      set({ settings: await ipc.saveSettings(next) });
    } catch (e) {
      set({ settings: previous });
      toast.error("Paramètres non enregistrés", errorMessage(e));
    }
  },
}));

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");
const motionQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

export function applyAppearance(s: Settings) {
  const root = document.documentElement;
  const dark =
    s.theme === "dark" || (s.theme === "system" && darkQuery().matches);
  const reduced =
    s.motion === "reduced" || (s.motion === "system" && motionQuery().matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.density = s.density;
  root.dataset.motion = reduced ? "reduced" : "full";
}

export function watchAppearance(): () => void {
  const apply = () => applyAppearance(useSettings.getState().settings);
  const unsub = useSettings.subscribe(apply);
  const dq = darkQuery();
  const mq = motionQuery();
  dq.addEventListener("change", apply);
  mq.addEventListener("change", apply);
  apply();
  return () => {
    unsub();
    dq.removeEventListener("change", apply);
    mq.removeEventListener("change", apply);
  };
}
