import { create } from "zustand";
import { Button } from "./primitives";
import { Dialog } from "./overlays";

export type Choice = "confirm" | "alternative" | "cancel";

interface ChoiceRequest {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  alternativeLabel?: string;
  resolve: (choice: Choice) => void;
}

const useConfirmStore = create<{ current: ChoiceRequest | null }>(() => ({
  current: null,
}));

export function askChoice(
  req: Omit<ChoiceRequest, "resolve">,
): Promise<Choice> {
  return new Promise((resolve) => {
    useConfirmStore.getState().current?.resolve("cancel");
    useConfirmStore.setState({ current: { ...req, resolve } });
  });
}

export async function askConfirm(
  req: Omit<ChoiceRequest, "resolve" | "alternativeLabel">,
): Promise<boolean> {
  return (await askChoice(req)) === "confirm";
}

export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  const close = (choice: Choice) => {
    current?.resolve(choice);
    useConfirmStore.setState({ current: null });
  };
  const alternative = current?.alternativeLabel;
  return (
    <Dialog
      open={!!current}
      onOpenChange={(o) => !o && close("cancel")}
      title={current?.title ?? ""}
      description={current?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close("cancel")}>
            Annuler
          </Button>
          <Button
            autoFocus={!alternative}
            variant={current?.danger ? "danger" : "primary"}
            onClick={() => close("confirm")}
          >
            {current?.confirmLabel}
          </Button>
          {alternative && (
            <Button
              autoFocus
              variant="primary"
              onClick={() => close("alternative")}
            >
              {alternative}
            </Button>
          )}
        </>
      }
    />
  );
}
