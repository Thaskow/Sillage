import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { comboOf, useHotkeys, type Binding } from "./hotkeys";

function press(target: HTMLElement, init: KeyboardEventInit) {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

describe("useHotkeys", () => {
  it("prend Ctrl+T avant le terminal", () => {
    const run = vi.fn();
    const bindings: Binding[] = [
      { id: "new-agent", label: "", keys: "Ctrl+T", run },
    ];
    renderHook(() => useHotkeys(bindings));
    const host = document.createElement("div");
    host.className = "xterm";
    const ta = document.createElement("textarea");
    host.appendChild(ta);
    document.body.appendChild(host);
    const inner = vi.fn();
    ta.addEventListener("keydown", inner);
    const e = press(ta, { key: "t", code: "KeyT", ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
    expect(inner).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("comboOf", () => {
  const ev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
  it("lit le chiffre physique en AZERTY", () => {
    expect(comboOf(ev({ key: "&", code: "Digit1", ctrlKey: true }))).toBe(
      "Ctrl+1",
    );
  });
  it("reconnaît Ctrl+T quand la touche arrive comme caractère de contrôle ou en composition", () => {
    expect(comboOf(ev({ key: "\x14", code: "KeyT", ctrlKey: true }))).toBe(
      "Ctrl+T",
    );
    expect(comboOf(ev({ key: "Process", code: "KeyT", ctrlKey: true }))).toBe(
      "Ctrl+T",
    );
  });
  it("garde la lettre de la disposition", () => {
    expect(comboOf(ev({ key: "w", code: "KeyZ", ctrlKey: true }))).toBe(
      "Ctrl+W",
    );
    expect(
      comboOf(ev({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true })),
    ).toBe("Ctrl+Shift+Tab");
  });
});
