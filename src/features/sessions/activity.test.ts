import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
  sendNotification: vi.fn(),
}));

import { onAgentActivity } from "./activity";
import { useSessions } from "./store";
import { runtimeStatus } from "./visuals";

const def = {
  id: "s1",
  groupId: "g1",
  title: "Claude Code",
} as never;

describe("onAgentActivity", () => {
  beforeEach(() => {
    useSessions.setState({
      defs: [def],
      runtime: { s1: { state: "running", startedAt: 1 } },
      focusedId: null,
    });
  });

  it("marque la session et notifie quand Sillage est en arrière-plan", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const notify = vi.fn();
    onAgentActivity({ id: "s1", activity: "waiting", at: 10 }, notify);
    const r = useSessions.getState().runtime.s1!;
    expect(r.unseen).toBe(true);
    expect(runtimeStatus(r).status).toBe("waiting");
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        title: "Claude Code",
        body: "Attend votre validation",
      }),
    );
  });

  it("ne notifie pas pendant le travail et ignore un état plus ancien", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const notify = vi.fn();
    onAgentActivity({ id: "s1", activity: "working", at: 20 }, notify);
    onAgentActivity({ id: "s1", activity: "done", at: 5 }, notify);
    const r = useSessions.getState().runtime.s1!;
    expect(r.activity).toBe("working");
    expect(runtimeStatus(r).status).toBe("active");
    expect(notify).not.toHaveBeenCalled();
  });

  it("le focus efface la pastille", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    onAgentActivity({ id: "s1", activity: "done", at: 30 }, vi.fn());
    expect(useSessions.getState().runtime.s1!.unseen).toBe(true);
    useSessions.getState().focus("s1");
    expect(useSessions.getState().runtime.s1!.unseen).toBe(false);
  });
});
