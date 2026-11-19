import { Fragment, useMemo, useRef, useState } from "react";
import type { Group, SessionDef } from "@/lib/ipc";
import { cx } from "@/lib/cx";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions } from "./store";
import { SessionPane } from "./SessionPane";

export type Arrangement = "row" | "column" | "grid";

export interface PanelLayout {
  arrangement: Arrangement;
  weights: Record<string, number>;
}

export function readLayout(g: Group): PanelLayout {
  const l = (g.layout ?? {}) as Partial<PanelLayout>;
  return {
    arrangement:
      l.arrangement === "column" || l.arrangement === "grid"
        ? l.arrangement
        : "row",
    weights: l.weights && typeof l.weights === "object" ? l.weights : {},
  };
}

export function PanelArea({
  group,
  sessions,
}: {
  group: Group;
  sessions: SessionDef[];
}) {
  const maximizedId = useSessions((s) => s.maximizedId);
  const updateGroup = useWorkspace((s) => s.updateGroup);
  const layout = readLayout(group);
  const [live, setLive] = useState<Record<string, number> | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const maximized = sessions.find((s) => s.id === maximizedId);
  const weights = live ?? layout.weights;
  const w = (id: string) => Math.max(0.1, weights[id] ?? 1);

  const visible = maximized ? [maximized] : sessions;
  const horizontal = layout.arrangement !== "column";

  const gridCols = useMemo(
    () => Math.ceil(Math.sqrt(visible.length)),
    [visible.length],
  );

  if (layout.arrangement === "grid" && !maximized) {
    return (
      <div
        className="grid h-full gap-1.5 p-1.5"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(0, 1fr)",
        }}
      >
        {visible.map((s) => (
          <SessionPane key={s.id} def={s} />
        ))}
      </div>
    );
  }

  const startDrag = (e: React.PointerEvent, a: SessionDef, b: SessionDef) => {
    const el = container.current;
    if (!el) return;
    e.preventDefault();
    const total = visible.reduce((sum, s) => sum + w(s.id), 0);
    const px = horizontal ? el.clientWidth : el.clientHeight;
    const start = horizontal ? e.clientX : e.clientY;
    const wa = w(a.id);
    const wb = w(b.id);
    let current: Record<string, number> = { ...weights };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const delta =
        (((horizontal ? ev.clientX : ev.clientY) - start) / px) * total;
      const min = (total * 140) / px;
      const na = Math.min(wa + wb - min, Math.max(min, wa + delta));
      current = { ...current, [a.id]: na, [b.id]: wa + wb - na };
      setLive(current);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setLive(null);
      updateGroup(group.id, { layout: { ...layout, weights: current } });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={container}
      className={cx("flex h-full p-1.5", horizontal ? "flex-row" : "flex-col")}
    >
      {visible.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              aria-label="Redimensionner les panneaux"
              onPointerDown={(e) => startDrag(e, visible[i - 1]!, s)}
              onDoubleClick={() =>
                updateGroup(group.id, { layout: { ...layout, weights: {} } })
              }
              className={cx(
                "group/split relative z-10 flex shrink-0 items-center justify-center",
                horizontal
                  ? "w-1.5 cursor-col-resize"
                  : "h-1.5 cursor-row-resize",
              )}
            >
              <span
                className={cx(
                  "rounded-full bg-transparent transition-colors duration-[var(--dur)] group-hover/split:bg-accent/50",
                  horizontal ? "h-8 w-[3px]" : "h-[3px] w-8",
                )}
              />
            </div>
          )}
          <div className="min-h-0 min-w-0" style={{ flex: `${w(s.id)} 1 0` }}>
            <SessionPane def={s} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
