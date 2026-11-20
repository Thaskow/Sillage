import { t } from "@/lib/i18n";
import { create } from "zustand";
import {
  errorMessage,
  sessionsIpc,
  type KindInfo,
  type NewSession,
  type SessionDef,
  type SessionKind,
} from "@/lib/ipc";
import { toast } from "@/design-system/toast";

export type RunState = "stopped" | "starting" | "running" | "exited" | "error";

export interface Runtime {
  state: RunState;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number | null;
  killed?: boolean;
  error?: string;
}

interface SessionsState {
  defs: SessionDef[];
  kinds: KindInfo[];
  runtime: Record<string, Runtime>;
  focusedId: string | null;
  maximizedId: string | null;
  load: () => Promise<void>;
  create: (s: NewSession) => Promise<SessionDef | null>;
  rename: (id: string, title: string) => Promise<void>;
  move: (id: string, groupId: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
  setProfile: (id: string, profileId: string | null) => Promise<void>;
  resetAgent: (id: string) => Promise<void>;
  setRuntime: (id: string, r: Runtime) => void;
  opening: Record<string, boolean>;
  setOpening: (id: string, v: boolean) => void;
  focus: (id: string | null) => void;
  toggleMaximize: (id: string) => void;
}

export const useSessions = create<SessionsState>((set) => ({
  defs: [],
  kinds: [],
  runtime: {},
  focusedId: null,
  maximizedId: null,
  opening: {},

  load: async () => {
    const [defs, kinds, running] = await Promise.all([
      sessionsIpc.list(),
      sessionsIpc.availableKinds().catch(() => [] as KindInfo[]),
      sessionsIpc.running().catch(() => []),
    ]);
    const runtime: Record<string, Runtime> = {};
    for (const d of defs) runtime[d.id] = { state: "stopped" };
    for (const r of running)
      runtime[r.id] = { state: "running", startedAt: r.startedAt };
    set({ defs, kinds, runtime });
  },

  create: async (s) => {
    try {
      const def = await sessionsIpc.create(s);
      set((st) => ({
        defs: [...st.defs, def],
        runtime: { ...st.runtime, [def.id]: { state: "stopped" } },
        focusedId: def.id,
        maximizedId: null,
      }));
      return def;
    } catch (e) {
      toast.error(t("Session non créée"), errorMessage(e));
      return null;
    }
  },

  rename: async (id, title) => {
    try {
      const def = await sessionsIpc.rename(id, title);
      set((st) => ({ defs: st.defs.map((d) => (d.id === id ? def : d)) }));
    } catch (e) {
      toast.error(t("Renommage impossible"), errorMessage(e));
    }
  },

  move: async (id, groupId) => {
    try {
      const def = await sessionsIpc.move(id, groupId);
      set((st) => ({ defs: st.defs.map((d) => (d.id === id ? def : d)) }));
    } catch (e) {
      toast.error(t("Déplacement impossible"), errorMessage(e));
    }
  },

  setProfile: async (id, profileId) => {
    try {
      await sessionsIpc.setProfile(id, profileId);
      set((st) => ({
        defs: st.defs.map((d) =>
          d.id === id
            ? { ...d, profileId, agentSessionId: null, agentStartedAt: null }
            : d,
        ),
      }));
    } catch (e) {
      toast.error(t("Changement de compte impossible"), errorMessage(e));
    }
  },

  resetAgent: async (id) => {
    try {
      await sessionsIpc.resetAgent(id);
      set((st) => ({
        defs: st.defs.map((d) =>
          d.id === id
            ? { ...d, agentSessionId: null, agentStartedAt: null }
            : d,
        ),
      }));
      toast.info(t("Le prochain lancement ouvrira une nouvelle conversation"));
    } catch (e) {
      toast.error(t("Action impossible"), errorMessage(e));
    }
  },

  remove: async (id) => {
    try {
      await sessionsIpc.remove(id);
      set((st) => {
        const runtime = { ...st.runtime };
        delete runtime[id];
        return {
          defs: st.defs.filter((d) => d.id !== id),
          runtime,
          focusedId: st.focusedId === id ? null : st.focusedId,
          maximizedId: st.maximizedId === id ? null : st.maximizedId,
          opening: Object.fromEntries(
            Object.entries(st.opening).filter(([k]) => k !== id),
          ),
        };
      });
      return true;
    } catch (e) {
      toast.error(t("Fermeture impossible"), errorMessage(e));
      return false;
    }
  },

  setRuntime: (id, r) => set((st) => ({ runtime: { ...st.runtime, [id]: r } })),
  setOpening: (id, v) => set((st) => ({ opening: { ...st.opening, [id]: v } })),
  focus: (focusedId) => set({ focusedId }),
  toggleMaximize: (id) =>
    set((st) => ({
      maximizedId: st.maximizedId === id ? null : id,
      focusedId: id,
    })),
}));

export const isAgentKind = (k: SessionKind) => k === "claude" || k === "codex";
