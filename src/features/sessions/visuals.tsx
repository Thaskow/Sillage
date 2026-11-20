import { t } from "@/lib/i18n";
import type { ComponentType } from "react";
import { SquareTerminal, Terminal } from "lucide-react";
import { ClaudeLogo, CodexLogo } from "@/design-system/brand-icons";
import type { SessionKind } from "@/lib/ipc";
import type { Status } from "@/design-system/primitives";
import type { Runtime } from "./store";

export type KindIcon = ComponentType<{ size?: number; className?: string }>;

export const kindIcon: Record<SessionKind, KindIcon> = {
  claude: ClaudeLogo,
  codex: CodexLogo,
  powershell: SquareTerminal,
  pwsh: SquareTerminal,
  cmd: Terminal,
  wsl: Terminal,
  custom: Terminal,
};

export function runtimeStatus(r: Runtime | undefined): {
  status: Status;
  label: string;
} {
  switch (r?.state) {
    case "running":
      return { status: "running", label: t("Processus actif") };
    case "starting":
      return { status: "running", label: t("Démarrage…") };
    case "exited":
      return r.killed
        ? { status: "idle", label: t("Arrêtée") }
        : r.exitCode === 0
          ? { status: "idle", label: t("Terminée") }
          : {
              status: "error",
              label: t("Terminée avec le code {code}", {
                code: r.exitCode ?? t("inconnu"),
              }),
            };
    case "error":
      return { status: "error", label: r.error ?? t("Erreur au démarrage") };
    default:
      return { status: "unknown", label: t("Non démarrée") };
  }
}

export function duration(from?: number, to = Date.now()): string {
  if (!from) return "—";
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
