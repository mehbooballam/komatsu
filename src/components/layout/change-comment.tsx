"use client";

import React, { useEffect, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Every change a person makes needs a comment. Call `askChangeComment` before
 * saving; it opens one shared dialog and resolves with the comment, or null if
 * the person cancels (then don't save). The comment is shown in the alert's
 * Notes together with the action taken.
 */
export interface ChangeCommentRequest {
  /** What is about to happen, e.g. "Move to group EPA › TSCA" */
  action: string;
  /** Optional context, e.g. "3 alerts" */
  detail?: string;
  confirmLabel?: string;
  /** The comment may be left empty (resolves with "" — only null means cancelled). */
  optional?: boolean;
}

type Pending = ChangeCommentRequest & { resolve: (comment: string | null) => void };
let open: ((req: Pending) => void) | null = null;

export function askChangeComment(req: ChangeCommentRequest): Promise<string | null> {
  return new Promise((resolve) => {
    if (!open) {
      // Host not mounted (shouldn't happen inside the app): fall back to the browser prompt
      const c = window.prompt(`${req.action}\n\nWhy are you making this change?${req.optional ? " (optional)" : ""}`);
      if (c === null) resolve(null);
      else resolve(c.trim() || (req.optional ? "" : null));
      return;
    }
    open({ ...req, resolve });
  });
}

/** Header carrying the comment, for DELETE requests that have no body. */
export function commentHeader(comment: string): Record<string, string> {
  return { "x-change-comment": encodeURIComponent(comment) };
}

const MIN = 3;
const MAX = 2000;

/** Mount once (in the app layout). */
export function ChangeCommentHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    open = (req) => {
      setText("");
      setPending(req);
    };
    return () => {
      open = null;
    };
  }, []);

  const finish = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };
  const valid = pending?.optional ? true : text.trim().length >= MIN;

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent
        className="z-[80] sm:max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          ref.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-blue-600 dark:text-blue-400" /> Comment on this change
          </DialogTitle>
          <DialogDescription>
            {pending?.optional
              ? "A reason is optional. If you add one, it is saved in the alert’s Notes with the action taken."
              : "Your comment is saved in the alert’s Notes with the action taken."}
          </DialogDescription>
        </DialogHeader>
        {pending && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) finish(text.trim());
            }}
            className="space-y-3"
          >
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Action</span>
              <span className="font-medium text-slate-900 dark:text-white">{pending.action}</span>
              {pending.detail && <span className="block text-xs text-slate-500">{pending.detail}</span>}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Why?{" "}
                {pending.optional ? <span className="font-normal text-slate-400">(optional)</span> : <span className="text-red-600">*</span>}
              </span>
              <textarea
                ref={ref}
                rows={3}
                maxLength={MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) {
                    e.preventDefault();
                    finish(text.trim());
                  }
                }}
                placeholder="e.g. Same RIN as the final rule; confirmed on regulations.gov"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => finish(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button type="submit" disabled={!valid} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {pending.confirmLabel || "Save change"}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
