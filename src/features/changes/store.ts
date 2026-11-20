import { create } from "zustand";

interface ChangesUi {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useChangesUi = create<ChangesUi>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
