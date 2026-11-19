import { create } from "zustand";
import { Button } from "./primitives";
import { Dialog } from "./overlays";

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ current: ConfirmRequest | null }>(() => ({
  current: null,
}));

export function askConfirm(
  req: Omit<ConfirmRequest, "resolve">,
): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().current?.resolve(false);
    useConfirmStore.setState({ current: { ...req, resolve } });
  });
}

export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  const close = (ok: boolean) => {
    current?.resolve(ok);
    useConfirmStore.setState({ current: null });
  };
  return (
    <Dialog
      open={!!current}
      onOpenChange={(o) => !o && close(false)}
      title={current?.title ?? ""}
      description={current?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Annuler
          </Button>
          <Button
            autoFocus
            variant={current?.danger ? "danger" : "primary"}
            onClick={() => close(true)}
          >
            {current?.confirmLabel}
          </Button>
        </>
      }
    />
  );
}
