import { t } from "@/lib/i18n";
import { create } from "zustand";
import { errorMessage, ipc, type Settings } from "@/lib/ipc";
import { defaultSettings } from "./defaults";
import { toast } from "@/design-system/toast";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

let saveSeq = 0;

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
    const seq = ++saveSeq;
    set({ settings: next });
    try {
      const saved = await ipc.saveSettings(next);
      if (seq === saveSeq) set({ settings: saved });
    } catch (e) {
      if (seq === saveSeq) set({ settings: previous });
      toast.error(t("Paramètres non enregistrés"), errorMessage(e));
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
