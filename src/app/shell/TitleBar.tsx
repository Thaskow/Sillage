import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, PanelLeft, Search, Square, X, Copy } from "lucide-react";
import { IconButton, Kbd } from "@/design-system/primitives";
import { useUi } from "@/app/ui-store";
import { useSettings } from "@/features/settings/store";
import { SillageMark } from "./SillageMark";
import { UpdateButton } from "@/features/updates/UpdateDialog";

const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function TitleBar() {
  const setPalette = useUi((s) => s.setPalette);
  const sidebarVisible = useSettings((s) => s.settings.sidebarVisible);
  const update = useSettings((s) => s.update);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    const w = getCurrentWindow();
    let off: (() => void) | undefined;
    let disposed = false;
    w.isMaximized()
      .then(setMaximized)
      .catch(() => {});
    w.onResized(() =>
      w
        .isMaximized()
        .then(setMaximized)
        .catch(() => {}),
    )
      .then((u) => {
        if (disposed) u();
        else off = u;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-[38px] shrink-0 items-center border-b border-line bg-surface pl-2"
    >
      <div className="flex items-center gap-1">
        <IconButton
          label={
            sidebarVisible
              ? t("Masquer la barre latérale")
              : t("Afficher la barre latérale")
          }
          shortcut="Ctrl B"
          size="sm"
          onClick={() => update({ sidebarVisible: !sidebarVisible })}
        >
          <PanelLeft size={15} />
        </IconButton>
        <div data-tauri-drag-region className="flex items-center gap-2 pl-1.5">
          <SillageMark size={15} />
          <span
            data-tauri-drag-region
            className="text-[12.5px] font-semibold tracking-[-0.01em]"
          >
            Sillage
          </span>
        </div>
      </div>

      <button
        onClick={() => setPalette(true)}
        className="transition-quick absolute left-1/2 flex h-[26px] w-[min(380px,40vw)] -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-bg px-2.5 leading-none text-fg-3 hover:border-line-strong hover:text-fg-2"
      >
        <Search size={13} />
        <span className="flex-1 text-left text-[12px]">
          {t("Rechercher groupes, sessions, actions…")}
        </span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div data-tauri-drag-region className="h-full flex-1" />

      <div className="flex h-full items-center">
        <UpdateButton />
        <WindowButton label={t("Réduire")} onClick={() => win().minimize()}>
          <Minus size={14} strokeWidth={1.6} />
        </WindowButton>
        <WindowButton
          label={maximized ? t("Restaurer") : t("Agrandir")}
          onClick={() => win().toggleMaximize()}
        >
          {maximized ? (
            <Copy size={11} strokeWidth={1.6} className="-scale-x-100" />
          ) : (
            <Square size={11} strokeWidth={1.6} />
          )}
        </WindowButton>
        <WindowButton label={t("Fermer")} danger onClick={() => win().close()}>
          <X size={15} strokeWidth={1.6} />
        </WindowButton>
      </div>
    </header>
  );
}

function WindowButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={
        "transition-quick flex h-full w-[46px] items-center justify-center text-fg-2 " +
        (danger
          ? "hover:bg-[#c42b1c] hover:text-white"
          : "hover:bg-hover hover:text-fg")
      }
    >
      {children}
    </button>
  );
}
