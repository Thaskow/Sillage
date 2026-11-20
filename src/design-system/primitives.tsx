import { t } from "@/lib/i18n";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import { cx } from "@/lib/cx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = "secondary", className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      {...rest}
      className={cx(
        "transition-quick inline-flex h-[var(--row)] items-center justify-center gap-1.5 rounded-md px-3 leading-none font-medium whitespace-nowrap [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" &&
          "bg-accent text-accent-fg hover:brightness-[1.06] active:brightness-95",
        variant === "secondary" &&
          "border border-line-strong bg-raised hover:bg-hover active:bg-active",
        variant === "ghost" &&
          "text-fg-2 hover:bg-hover hover:text-fg active:bg-active",
        variant === "danger" &&
          "bg-err text-white hover:brightness-[1.06] active:brightness-95",
        className,
      )}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    size?: "sm" | "md";
    shortcut?: string;
    active?: boolean;
  }
>(function IconButton(
  { label, size = "md", shortcut, active, className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={active}
        {...rest}
        className={cx(
          "transition-quick inline-flex shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg active:bg-active disabled:opacity-40",
          size === "md" ? "size-[var(--row)]" : "size-6",
          active && "bg-active text-fg",
          className,
        )}
      />
    </Tooltip>
  );
});

export function Tooltip({
  content,
  shortcut,
  side = "bottom",
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="anim-pop z-50 flex max-w-72 items-center gap-2 rounded-md border border-line bg-raised px-2 py-1 text-[var(--fs-sm)] text-fg shadow-pop"
        >
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] border border-line-strong bg-sunken px-1.5 font-sans text-[10.5px] leading-none font-medium text-fg-3">
      {children}
    </kbd>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      {...rest}
      className={cx(
        "transition-quick h-[var(--row)] w-full rounded-md border border-line-strong bg-raised px-2.5 text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none focus-visible:outline-none",
        className,
      )}
    />
  );
});

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[var(--fs-sm)] font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="text-[var(--fs-sm)] text-fg-3">{hint}</span>}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="anim-fade flex h-full w-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-fg-3">
        {icon}
      </div>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {children && <p className="mt-1.5 max-w-sm text-fg-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export type Status =
  "active" | "running" | "waiting" | "idle" | "error" | "unknown";

const statusLabel: Record<Status, string> = {
  active: "Activité confirmée",
  running: "Processus actif, activité non observée",
  waiting: "Intervention demandée",
  idle: "Inactif",
  error: "Erreur",
  unknown: "État indéterminé",
};

export function StatusDot({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={t(statusLabel[status])}
      className={cx(
        "inline-block size-[7px] shrink-0 rounded-full",
        status === "active" && "bg-ok",
        status === "running" && "bg-accent",
        status === "waiting" &&
          "bg-wait motion-safe:animate-[breathe_1.8s_ease-in-out_infinite]",
        status === "idle" && "bg-idle",
        status === "error" && "bg-err",
        status === "unknown" && "border border-dashed border-fg-3",
        className,
      )}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "transition-quick relative h-[18px] w-[30px] rounded-full",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cx(
          "transition-quick absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm",
          checked && "translate-x-[12px]",
        )}
      />
    </button>
  );
}
