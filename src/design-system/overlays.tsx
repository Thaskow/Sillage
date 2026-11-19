import type { ReactNode } from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as RContext from "@radix-ui/react-context-menu";
import * as RDropdown from "@radix-ui/react-dropdown-menu";
import { cx } from "@/lib/cx";
import { Button } from "./primitives";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[var(--scrim)]" />
        <RDialog.Content
          style={{ width }}
          className="anim-pop fixed top-[18%] left-1/2 z-50 max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-line bg-raised shadow-dialog focus:outline-none"
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="px-5 pt-4.5">
            <RDialog.Title className="text-[15px] font-semibold tracking-[-0.01em]">
              {title}
            </RDialog.Title>
            {description && (
              <RDialog.Description className="mt-1 text-fg-2">
                {description}
              </RDialog.Description>
            )}
          </div>
          {children && <div className="px-5 pt-4">{children}</div>}
          <div className="mt-5 flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | "separator";

const menuSurface =
  "anim-pop z-50 min-w-48 rounded-lg border border-line bg-raised p-1 shadow-pop focus:outline-none";
const itemCls =
  "flex h-[var(--row-sm)] cursor-default items-center gap-2 rounded-[5px] px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover";

function renderItems<T extends typeof RContext | typeof RDropdown>(
  Lib: T,
  items: MenuEntry[],
) {
  return items.map((it, i) =>
    it === "separator" ? (
      <Lib.Separator key={i} className="mx-1 my-1 h-px bg-line" />
    ) : (
      <Lib.Item
        key={it.label}
        disabled={it.disabled}
        onSelect={it.onSelect}
        className={cx(itemCls, it.danger && "text-err")}
      >
        <span className="flex w-4 justify-center text-fg-3 [&>svg]:size-[14px]">
          {it.icon}
        </span>
        <span className="flex-1">{it.label}</span>
        {it.shortcut && (
          <span className="text-[11px] text-fg-3">{it.shortcut}</span>
        )}
      </Lib.Item>
    ),
  );
}

export function ContextMenu({
  items,
  children,
}: {
  items: MenuEntry[];
  children: ReactNode;
}) {
  return (
    <RContext.Root>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content collisionPadding={8} className={menuSurface}>
          {renderItems(RContext, items)}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

export function DropdownMenu({
  items,
  children,
  align = "start",
}: {
  items: MenuEntry[];
  children: ReactNode;
  align?: "start" | "end";
}) {
  return (
    <RDropdown.Root>
      <RDropdown.Trigger asChild>{children}</RDropdown.Trigger>
      <RDropdown.Portal>
        <RDropdown.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className={menuSurface}
        >
          {renderItems(RDropdown, items)}
        </RDropdown.Content>
      </RDropdown.Portal>
    </RDropdown.Root>
  );
}
