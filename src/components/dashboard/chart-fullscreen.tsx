"use client";

import type { ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Small icon button that opens a chart in full screen. */
export function FullscreenButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`View ${label} full screen`}
      title="Full screen"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-blue-400"
    >
      <Maximize2 className="h-[18px] w-[18px]" />
    </button>
  );
}

/** Near-full-screen dialog for a chart. The chart fills the space between the header and footer. */
export function ChartFullscreen({
  open,
  onOpenChange,
  title,
  subtitle,
  actions,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-3 p-4 sm:rounded-2xl sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
          <div className="min-w-0">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <DialogDescription className={subtitle ? "mt-1 text-xs" : "sr-only"}>{subtitle || title}</DialogDescription>
          </div>
          {actions}
        </div>
        <div className="min-h-0 flex-1">{children}</div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
