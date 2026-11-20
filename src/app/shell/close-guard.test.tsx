import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmHost } from "@/design-system/confirm";
import { useSessions } from "@/features/sessions/store";
import { askCloseWithRunning, runningSessionCount } from "./close-guard";

describe("close guard", () => {
  it("compte seulement les sessions démarrées ou en cours", () => {
    useSessions.setState({
      defs: [{ id: "a" }, { id: "b" }, { id: "c" }] as never,
      runtime: {
        a: { state: "running" },
        b: { state: "starting" },
        c: { state: "exited" },
      },
    });
    expect(runningSessionCount()).toBe(2);
  });

  it.each([
    ["Réduire", "alternative"],
    ["Fermer quand même", "confirm"],
    ["Annuler", "cancel"],
  ])("« %s » renvoie %s", async (label, expected) => {
    render(<ConfirmHost />);
    const choice = askCloseWithRunning(2);
    expect(
      await screen.findByText(/2 sessions sont en cours/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(await choice).toBe(expected);
  });
});
