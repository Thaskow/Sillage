import { create } from "zustand";

export type AgentsTab = "usage" | "settings";

export type View = "workspace" | "agents" | "activity" | "history" | "settings";

interface UiState {
  view: View;
  agentsTab: AgentsTab;
  paletteOpen: boolean;
  groupDialog:
    | { mode: "create"; fromScratch?: boolean }
    | { mode: "edit"; groupId: string }
    | null;
  setView: (v: View) => void;
  openAgents: (tab: AgentsTab) => void;
  setPalette: (open: boolean) => void;
  openGroupDialog: (d: UiState["groupDialog"]) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "workspace",
  agentsTab: "usage",
  paletteOpen: false,
  groupDialog: null,
  setView: (view) => set({ view }),
  openAgents: (agentsTab) => set({ view: "agents", agentsTab }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  openGroupDialog: (groupDialog) => set({ groupDialog }),
}));
