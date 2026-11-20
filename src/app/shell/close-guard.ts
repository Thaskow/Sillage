import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askChoice, type Choice } from "@/design-system/confirm";
import { useSessions } from "@/features/sessions/store";

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function runningSessionCount() {
  const { defs, runtime } = useSessions.getState();
  return defs.filter((d) => {
    const s = runtime[d.id]?.state;
    return s === "running" || s === "starting";
  }).length;
}

export function askCloseWithRunning(count: number): Promise<Choice> {
  return askChoice({
    title: "Réduire Sillage plutôt que le fermer ?",
    description:
      count > 1
        ? `${count} sessions sont en cours : fermer Sillage arrêterait leurs processus et annulerait les prompts en cours. Réduire la fenêtre les laisse continuer.`
        : "Une session est en cours : fermer Sillage arrêterait son processus et annulerait le prompt en cours. Réduire la fenêtre la laisse continuer.",
    alternativeLabel: "Réduire",
    confirmLabel: "Fermer quand même",
    danger: true,
  });
}

export function useCloseGuard() {
  useEffect(() => {
    if (!inTauri) return;
    const win = getCurrentWindow();
    let off: (() => void) | undefined;
    let disposed = false;
    win
      .onCloseRequested(async (event) => {
        const count = runningSessionCount();
        if (!count) return;
        event.preventDefault();
        const choice = await askCloseWithRunning(count);
        if (choice === "alternative") await win.minimize();
        else if (choice === "confirm") await win.destroy();
      })
      .then((u) => (disposed ? u() : (off = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
}
