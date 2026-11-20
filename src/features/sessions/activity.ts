import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useUi } from "@/app/ui-store";
import { useSettings } from "@/features/settings/store";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions, type Activity } from "./store";

export interface ActivityEvent {
  id: string;
  activity: Activity;
  at: number;
}

const message: Record<Exclude<Activity, "working">, string> = {
  waiting: "Attend votre validation",
  done: "A terminé, à vous de reprendre",
};

let allowed: Promise<boolean> | null = null;

function canNotify(): Promise<boolean> {
  allowed ??= isPermissionGranted()
    .then((ok) => ok || requestPermission().then((p) => p === "granted"))
    .catch(() => false);
  return allowed;
}

export function onAgentActivity(e: ActivityEvent, notify = sendNotification) {
  const st = useSessions.getState();
  const prev = st.runtime[e.id]?.activity;
  const visible =
    document.hasFocus() &&
    st.focusedId === e.id &&
    useUi.getState().view === "workspace";
  const attention = e.activity !== "working";
  st.setActivity(e.id, e.activity, e.at, attention && !visible);
  if (!attention || prev === e.activity || document.hasFocus()) return;
  if (!useSettings.getState().settings.notificationsEnabled) return;
  const def = st.defs.find((d) => d.id === e.id);
  if (!def) return;
  const group = useWorkspace
    .getState()
    .groups.find((g) => g.id === def.groupId);
  const title = group ? `${def.title} · ${group.name}` : def.title;
  const body = message[e.activity as keyof typeof message];
  void canNotify().then((ok) => ok && notify({ title, body }));
}

export function useUnseen(groupId: string): number {
  return useSessions(
    (s) =>
      s.defs.filter((d) => d.groupId === groupId && s.runtime[d.id]?.unseen)
        .length,
  );
}
