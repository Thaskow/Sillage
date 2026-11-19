import { Download, Loader2 } from "lucide-react";
import { Button } from "@/design-system/primitives";
import { Dialog } from "@/design-system/overlays";
import { useUpdates } from "./store";

export function UpdateButton() {
  const status = useUpdates((s) => s.status);
  const version = useUpdates((s) => s.version);
  const open = useUpdates((s) => s.setDialogOpen);
  if (
    status !== "available" &&
    status !== "downloading" &&
    status !== "installing"
  )
    return null;
  return (
    <button
      onClick={() => open(true)}
      className="transition-quick mr-2 flex h-[24px] items-center gap-1.5 rounded-md bg-accent/15 px-2 text-[12px] font-medium text-accent hover:bg-accent/25"
    >
      {status === "available" ? (
        <Download size={12} />
      ) : (
        <Loader2 size={12} className="animate-spin" />
      )}
      Mise à jour {version}
    </button>
  );
}

export function UpdateDialog() {
  const s = useUpdates();
  const busy = s.status === "downloading" || s.status === "installing";
  return (
    <Dialog
      open={s.dialogOpen}
      onOpenChange={(o) => !busy && s.setDialogOpen(o)}
      title={`Sillage ${s.version ?? ""} est disponible`}
      description="La mise à jour est téléchargée depuis les versions publiées sur GitHub, sa signature est vérifiée, puis Sillage redémarre. Les sessions en cours sont fermées et reprises au redémarrage."
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => s.setDialogOpen(false)}
          >
            Plus tard
          </Button>
          <Button
            variant="primary"
            disabled={busy || s.status !== "available"}
            onClick={() => void s.install()}
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {s.status === "installing"
              ? "Installation…"
              : s.status === "downloading"
                ? "Téléchargement…"
                : "Mettre à jour et redémarrer"}
          </Button>
        </>
      }
    >
      {s.notes && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-line bg-sunken px-3 py-2 text-[var(--fs-sm)] whitespace-pre-wrap text-fg-2">
          {s.notes}
        </div>
      )}
      {busy && (
        <div
          role="progressbar"
          aria-label="Téléchargement de la mise à jour"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((s.progress ?? 0) * 100)}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.round((s.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}
      {s.status === "error" && s.error && (
        <p className="mt-3 text-[var(--fs-sm)] text-err">{s.error}</p>
      )}
    </Dialog>
  );
}
