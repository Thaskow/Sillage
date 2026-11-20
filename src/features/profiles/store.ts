import { t } from "@/lib/i18n";
import { create } from "zustand";
import {
  errorMessage,
  profilesIpc,
  type NewProfile,
  type Profile,
  type ProfilePatch,
  type Provider,
  type SessionKind,
} from "@/lib/ipc";
import { toast } from "@/design-system/toast";

interface ProfilesState {
  profiles: Profile[];
  load: () => Promise<void>;
  create: (p: NewProfile) => Promise<Profile | null>;
  update: (id: string, patch: ProfilePatch) => Promise<void>;
  remove: (id: string, removeFiles: boolean) => Promise<boolean>;
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  load: async () => {
    try {
      set({ profiles: await profilesIpc.list() });
    } catch (e) {
      toast.error(t("Comptes indisponibles"), errorMessage(e));
    }
  },
  create: async (p) => {
    try {
      const created = await profilesIpc.create(p);
      set({ profiles: [...get().profiles, created] });
      return created;
    } catch (e) {
      toast.error(t("Création du compte impossible"), errorMessage(e));
      return null;
    }
  },
  update: async (id, patch) => {
    try {
      const updated = await profilesIpc.update(id, patch);
      set({ profiles: get().profiles.map((p) => (p.id === id ? updated : p)) });
    } catch (e) {
      toast.error(t("Modification impossible"), errorMessage(e));
    }
  },
  remove: async (id, removeFiles) => {
    try {
      await profilesIpc.remove(id, removeFiles);
      set({ profiles: get().profiles.filter((p) => p.id !== id) });
      return true;
    } catch (e) {
      toast.error(t("Suppression impossible"), errorMessage(e));
      return false;
    }
  },
}));

export function providerOf(kind: SessionKind): Provider | null {
  return kind === "claude" || kind === "codex" ? kind : null;
}

export const providerLabel: Record<Provider, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const providerWords = new Set(["claude", "codex"]);

const accountWords = [
  "Aston",
  "Nova",
  "Orion",
  "Lyra",
  "Vega",
  "Atlas",
  "Cobalt",
  "Ember",
  "Indigo",
  "Kestrel",
  "Lumen",
  "Nimbus",
  "Onyx",
  "Quartz",
  "Sable",
  "Zephyr",
  "Opale",
  "Ambre",
  "Sirocco",
  "Cèdre",
  "Négatif",
  "Polaris",
  "Rubis",
  "Tango",
  "Volta",
  "Halo",
  "Boréal",
  "Pixel",
  "Saphir",
  "Comète",
];

export function randomAccountName(provider: Provider, taken: string[]): string {
  const prefix = providerLabel[provider].split(" ")[0]!;
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const free = accountWords
    .map((w) => `${prefix} ${w}`)
    .filter((n) => !used.has(n.toLowerCase()));
  const pool = free.length ? free : accountWords.map((w) => `${prefix} ${w}`);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function initials(name: string): string {
  let words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1 && providerWords.has(words[0]!.toLowerCase()))
    words = words.slice(1);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  const [a, b] = words;
  const letters = a && b ? a.charAt(0) + b.charAt(0) : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

export function accountLine(p: Profile): string {
  if (!p.status.signedIn) return t("Non connecté");
  return (
    [p.status.email, p.status.organization].filter(Boolean).join(" · ") ||
    t("Connecté")
  );
}
