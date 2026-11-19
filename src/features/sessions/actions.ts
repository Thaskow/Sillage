import type { SessionKind } from "@/lib/ipc";
import { askConfirm } from "@/design-system/confirm";
import { toast } from "@/design-system/toast";
import { useWorkspace } from "@/features/workspace/store";
import { useUi } from "@/app/ui-store";
import { sessionsIpc, errorMessage } from "@/lib/ipc";
import { providerOf, useProfiles } from "@/features/profiles/store";
import { useSettings } from "@/features/settings/store";
import { useSessions } from "./store";
import { terminals } from "./terminal-registry";

export function groupSessions(groupId: string | null) {
  return useSessions
    .getState()
    .defs.filter((d) => d.groupId === groupId)
    .sort((a, b) => a.position - b.position);
}

export function defaultProfileFor(
  kind: SessionKind,
  groupId?: string | null,
): string | null {
  const provider = providerOf(kind);
  if (!provider) return null;
  const settings = useSettings.getState().settings;
  const group = useWorkspace.getState().groups.find((g) => g.id === groupId);
  const usable = (pid: string | null | undefined) =>
    useProfiles
      .getState()
      .profiles.find((p) => p.id === pid && p.provider === provider)?.id;
  return (
    usable(group?.defaultProfileId) ??
    usable(
      provider === "claude"
        ? settings.defaultClaudeProfile
        : settings.defaultCodexProfile,
    ) ??
    null
  );
}

export async function newSession(kind: SessionKind, profileId?: string | null) {
  const groupId = useWorkspace.getState().selectedId;
  if (!groupId) {
    toast.info("Choisissez d'abord un groupe");
    return;
  }
  const info = useSessions.getState().kinds.find((k) => k.kind === kind);
  if (info && !info.path) {
    toast.error(
      `${info.label} est introuvable`,
      "Installez-le ou ajoutez-le au PATH, puis relancez Sillage.",
    );
    return;
  }
  useUi.getState().setView("workspace");
  const chosen =
    profileId === undefined ? defaultProfileFor(kind, groupId) : profileId;
  const def = await useSessions
    .getState()
    .create({ groupId, kind, profileId: chosen });
  if (def) void terminals.start(def.id);
}

export async function moveAllSessions(fromGroupId: string, toGroupId: string) {
  const { defs, move } = useSessions.getState();
  const from = useWorkspace.getState().groups.find((g) => g.id === fromGroupId);
  for (const d of defs
    .filter((x) => x.groupId === fromGroupId)
    .sort((a, b) => a.position - b.position))
    await move(d.id, toGroupId);
  const to = useWorkspace.getState().groups.find((g) => g.id === toGroupId);
  if (from?.layout && to && !to.layout)
    await useWorkspace
      .getState()
      .updateGroup(toGroupId, { layout: from.layout });
  useWorkspace.getState().select(toGroupId);
  useUi.getState().setView("workspace");
}

export function resumeSessions() {
  const { defs, runtime } = useSessions.getState();
  for (const d of defs) {
    const st = runtime[d.id]?.state;
    if (d.resume && (!st || st === "stopped")) void terminals.start(d.id);
  }
}

export async function stopSession(id: string) {
  const def = useSessions.getState().defs.find((d) => d.id === id);
  const ok = await askConfirm({
    title: `Arrêter « ${def?.title ?? "la session"} » ?`,
    description:
      "Le processus et ses processus enfants seront arrêtés immédiatement. Le travail non enregistré sera perdu.",
    confirmLabel: "Arrêter",
    danger: true,
  });
  if (!ok) return;
  try {
    await sessionsIpc.kill(id);
  } catch (e) {
    toast.error("Arrêt impossible", errorMessage(e));
  }
}

export async function closeSession(id: string) {
  const { defs, runtime, remove } = useSessions.getState();
  const def = defs.find((d) => d.id === id);
  const running =
    runtime[id]?.state === "running" || runtime[id]?.state === "starting";
  if (running) {
    const ok = await askConfirm({
      title: `Fermer « ${def?.title ?? "la session"} » ?`,
      description:
        "La session est en cours : son processus sera arrêté puis le panneau retiré du groupe.",
      confirmLabel: "Arrêter et fermer",
      danger: true,
    });
    if (!ok) return;
  }
  await remove(id);
  terminals.dispose(id);
}

export function cycleFocus(step: 1 | -1) {
  const { focusedId, focus, maximizedId } = useSessions.getState();
  const list = groupSessions(useWorkspace.getState().selectedId);
  if (!list.length) return;
  const i = list.findIndex((d) => d.id === focusedId);
  const next = list[(i + step + list.length) % list.length]!;
  if (maximizedId) useSessions.setState({ maximizedId: next.id });
  focus(next.id);
  terminals.focus(next.id);
}
