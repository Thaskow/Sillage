import { useEffect } from "react";
import { useUi } from "./ui-store";
import { useSettings } from "@/features/settings/store";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions } from "@/features/sessions/store";
import { useChangesUi } from "@/features/changes/store";
import {
  closeSession,
  cycleFocus,
  newSession,
} from "@/features/sessions/actions";

export interface Binding {
  id: string;
  label: string;
  keys: string;
  run: () => void;
}

// AZERTY gives "&" for Ctrl+1; IME/dead keys give "Process" or "Dead".
function keyOf(e: KeyboardEvent): string {
  const digit = /^Digit(\d)$/.exec(e.code ?? "");
  if (digit && (e.ctrlKey || e.altKey)) return digit[1]!;
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(e.code ?? "");
  if (letter && (e.key.length !== 1 || e.key.charCodeAt(0) < 32))
    return letter[1]!;
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

export function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  const k = keyOf(e);
  if (!["Control", "Shift", "Alt", "Meta"].includes(k)) parts.push(k);
  return parts.join("+");
}

function pinnedGroups() {
  return useWorkspace.getState().groups.filter((g) => g.pinned && !g.archived);
}

export const defaultBindings: Binding[] = [
  {
    id: "palette",
    label: "Recherche globale",
    keys: "Ctrl+K",
    run: () => useUi.getState().setPalette(true),
  },
  {
    id: "sidebar",
    label: "Afficher ou masquer la barre latérale",
    keys: "Ctrl+B",
    run: () => {
      const { settings, update } = useSettings.getState();
      update({ sidebarVisible: !settings.sidebarVisible });
    },
  },
  {
    id: "new-group",
    label: "Nouveau groupe",
    keys: "Ctrl+Shift+N",
    run: () => useUi.getState().openGroupDialog({ mode: "create" }),
  },
  {
    id: "new-agent",
    label: "Nouvelle session Claude Code",
    keys: "Ctrl+T",
    run: () => void newSession("claude"),
  },
  {
    id: "new-terminal",
    label: "Nouveau terminal PowerShell",
    keys: "Ctrl+Shift+T",
    run: () => void newSession("powershell"),
  },
  {
    id: "close-pane",
    label: "Fermer le panneau actif",
    keys: "Ctrl+W",
    run: () => {
      const id = useSessions.getState().focusedId;
      if (id) void closeSession(id);
    },
  },
  {
    id: "next-pane",
    label: "Session suivante",
    keys: "Ctrl+Tab",
    run: () => cycleFocus(1),
  },
  {
    id: "close-pane-anywhere",
    label: "Fermer le panneau actif, même depuis un terminal",
    keys: "Ctrl+Shift+W",
    run: () => {
      const id = useSessions.getState().focusedId;
      if (id) void closeSession(id);
    },
  },
  {
    id: "palette-anywhere",
    label: "Recherche globale, même depuis un terminal",
    keys: "Ctrl+Shift+P",
    run: () => useUi.getState().setPalette(true),
  },
  {
    id: "prev-pane",
    label: "Session précédente",
    keys: "Ctrl+Shift+Tab",
    run: () => cycleFocus(-1),
  },
  {
    id: "changes",
    label: "Afficher ou masquer les modifications",
    keys: "Ctrl+Shift+G",
    run: () => useChangesUi.getState().toggle(),
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `favorite-${i + 1}`,
    label: `Groupe épinglé ${i + 1}`,
    keys: `Ctrl+${i + 1}`,
    run: () => {
      const g = pinnedGroups()[i];
      if (!g) return;
      useWorkspace.getState().select(g.id);
      useUi.getState().setView("workspace");
    },
  })),
];

const reserved = new Set(defaultBindings.map((b) => b.keys));
// shell and agent editing keys (readline, Claude Code): left to the terminal
const terminalKeys = new Set(["Ctrl+K", "Ctrl+B", "Ctrl+T", "Ctrl+W"]);

export function isReservedCombo(e: KeyboardEvent): boolean {
  const combo = comboOf(e);
  return reserved.has(combo) && !terminalKeys.has(combo);
}

function inTerminal(t: EventTarget | null): boolean {
  return t instanceof Element && !!t.closest(".xterm");
}

function isTextEditing(t: HTMLElement | null): boolean {
  if (!t || t.closest(".xterm")) return false;
  return (
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
  );
}

export function useHotkeys(bindings: Binding[] = defaultBindings) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const b = bindings.find((x) => x.keys === combo);
      if (!b) return;
      if (terminalKeys.has(combo) && inTerminal(e.target)) return;
      if (
        isTextEditing(e.target as HTMLElement | null) &&
        !b.id.startsWith("palette")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      b.run();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [bindings]);
}
