import { t } from "@/lib/i18n";
import { Fragment, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Group, SessionDef } from "@/lib/ipc";
import { cx } from "@/lib/cx";
import { StatusDot } from "@/design-system/primitives";
import { useWorkspace } from "@/features/workspace/store";
import { useSessions } from "./store";
import { SessionPane } from "./SessionPane";
import { closeSession } from "./actions";
import { kindIcon, runtimeStatus } from "./visuals";

export type Arrangement = "row" | "column" | "grid" | "tabs";

export interface PanelLayout {
  arrangement: Arrangement;
  weights: Record<string, number>;
}

export function readLayout(g: Group): PanelLayout {
  const l = (g.layout ?? {}) as Partial<PanelLayout>;
  return {
    arrangement:
      l.arrangement === "column" ||
      l.arrangement === "grid" ||
      l.arrangement === "tabs"
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
  const focusedId = useSessions((s) => s.focusedId);
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

  if (layout.arrangement === "tabs") {
    const active =
      sessions.find((s) => s.id === focusedId) ??
      sessions.find((s) => s.id === lastTab.get(group.id)) ??
      sessions[0]!;
    lastTab.set(group.id, active.id);
    return <TabbedPanels sessions={sessions} active={active} />;
  }

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
      target.removeEventListener("pointercancel", up);
      setLive(null);
      updateGroup(group.id, { layout: { ...layout, weights: current } });
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
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
              aria-label={t("Redimensionner les panneaux")}
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

const lastTab = new Map<string, string>();

function TabbedPanels({
  sessions,
  active,
}: {
  sessions: SessionDef[];
  active: SessionDef;
}) {
  const focus = useSessions((s) => s.focus);
  const runtime = useSessions((s) => s.runtime);
  const tabs = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = sessions.indexOf(active);
    const n = sessions.length;
    const next = sessions[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!;
    focus(next.id);
    tabs.current
      ?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)
      ?.focus();
  };

  return (
    <div className="flex h-full flex-col p-1.5">
      <div
        ref={tabs}
        role="tablist"
        aria-label={t("Sessions du groupe")}
        onKeyDown={onKeyDown}
        className="flex shrink-0 gap-0.5 overflow-x-auto pb-1.5"
      >
        {sessions.map((s) => {
          const Icon = kindIcon[s.kind];
          const selected = s.id === active.id;
          return (
            <div
              key={s.id}
              className={cx(
                "group/tab transition-quick flex h-[30px] max-w-[220px] min-w-[120px] shrink-0 items-center rounded-md border",
                selected
                  ? "border-line-strong bg-[var(--terminal-bg)] text-fg"
                  : "border-transparent text-fg-3 hover:bg-sunken hover:text-fg-2",
              )}
            >
              <button
                role="tab"
                data-tab={s.id}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => focus(s.id)}
                onAuxClick={(e) => e.button === 1 && closeSession(s.id)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2.5 text-left text-[12.5px]"
              >
                <StatusDot status={runtimeStatus(runtime[s.id]).status} />
                <Icon size={13} className="shrink-0" />
                <span className={cx("truncate", selected && "font-medium")}>
                  {s.title}
                </span>
              </button>
              <button
                aria-label={t("Fermer {name}", { name: s.title })}
                tabIndex={-1}
                onClick={() => closeSession(s.id)}
                className={cx(
                  "mr-1 flex size-5 shrink-0 items-center justify-center rounded-[4px] text-fg-3 hover:bg-sunken hover:text-fg",
                  selected
                    ? "opacity-100"
                    : "opacity-0 group-hover/tab:opacity-100",
                )}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div role="tabpanel" aria-label={active.title} className="min-h-0 flex-1">
        <SessionPane key={active.id} def={active} />
      </div>
    </div>
  );
}
