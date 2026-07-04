"use client";

import { TriangleAlert } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mounted once at the app root. Renders the single dialog instance every
 * `useConfirm()` call anywhere in the tree shares, so callers don't each
 * need their own `{dialog}` JSX — just `const confirm = useConfirm()`.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (value: boolean) => {
    setOptions(null);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="border-border bg-surface w-full max-w-sm rounded-3xl border p-6 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-2xl ${
                  options.destructive
                    ? "bg-destructive/10 text-destructive"
                    : "bg-brand-soft text-brand"
                }`}
              >
                <TriangleAlert className="size-5" />
              </span>
              <div className="min-w-0 pt-1.5">
                <h2 className="text-base font-semibold">{options.title}</h2>
                {options.description && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {options.description}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="border-border bg-background hover:bg-surface-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors"
              >
                {options.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 ${
                  options.destructive
                    ? "bg-destructive text-white"
                    : "bg-brand text-brand-foreground"
                }`}
              >
                {options.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based, theme-matching replacement for window.confirm() — the
 * native dialog renders as unstyled browser chrome that clashes with the
 * app's design. Usage mirrors window.confirm: `if (!(await confirm({
 * title }))) return;`. Requires `<ConfirmDialogProvider>` mounted once
 * above the tree (it's in the root layout) — no per-component dialog JSX
 * needed.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used within a ConfirmDialogProvider");
  }
  return confirm;
}
