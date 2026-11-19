"use client";

import { useEffect, useState } from "react";
import { Lock, Users, Loader2, Pencil, Trash2, MessageSquareText, Send, History, Sparkles } from "lucide-react";
import { UserAvatar } from "@/components/ui/brand";

export interface AlertNote {
  id: string;
  body: string;
  visibility: "private" | "team";
  created_at: string;
  updated_at: string | null;
  author_name: string;
  author_avatar: string | null;
  mine: boolean;
  /** "change" = a record of a change (action + the comment given); "comment" = a free note */
  kind?: "comment" | "change";
  action?: string | null;
  author_membership_id?: string | null;
}

const MAX = 5000;

/** "18 Nov 2026, 14:05" in the viewer's locale and time zone. */
export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : "";
}

function VisibilityToggle({ value, onChange }: { value: "private" | "team"; onChange: (v: "private" | "team") => void }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-slate-800" role="radiogroup" aria-label="Who can see this note">
      {(["private", "team"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
            value === v ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {v === "private" ? <Lock className="h-3 w-3" /> : <Users className="h-3 w-3" />}
          {v === "private" ? "Only me" : "Team"}
        </button>
      ))}
    </div>
  );
}

/**
 * Notes on an alert, shown as a comment thread (newest first) with author, date and time.
 * Private notes are only visible to their author; team notes to everyone in the workspace.
 */
export function AlertNotes({
  alertId,
  isAdmin,
  onCount,
}: {
  alertId: string;
  isAdmin?: boolean;
  onCount?: (n: number) => void;
}) {
  const [notes, setNotes] = useState<AlertNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">("private");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [show, setShow] = useState<"all" | "comment" | "change">("all");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts/${alertId}/notes`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => {
        if (cancelled) return;
        setNotes(d.notes || []);
      });
    return () => {
      cancelled = true;
    };
  }, [alertId]);

  useEffect(() => {
    if (notes) onCount?.(notes.length);
  }, [notes, onCount]);

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, visibility }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save note");
      setNotes((n) => [data.note, ...(n || [])]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save note");
    } finally {
      setPosting(false);
    }
  }

  async function update(id: string, patch: { body?: string; visibility?: "private" | "team" }) {
    setError(null);
    const res = await fetch(`/api/alerts/${alertId}/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not update note");
      return false;
    }
    setNotes((n) => (n || []).map((x) => (x.id === id ? data.note : x)));
    return true;
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/alerts/${alertId}/notes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Could not delete note");
      return;
    }
    setNotes((n) => (n || []).filter((x) => x.id !== id));
    setConfirmDelete(null);
  }

  return (
    <div className="space-y-4">
      {/* Composer */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900/40">
        <label htmlFor={`note-${alertId}`} className="sr-only">Write a note</label>
        <textarea
          id={`note-${alertId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              post();
            }
          }}
          rows={3}
          placeholder="Write a note about this alert…"
          className="block w-full resize-y bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <VisibilityToggle value={visibility} onChange={setVisibility} />
          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] text-slate-400 sm:inline">Ctrl + Enter to save</span>
            <button
              type="button"
              onClick={post}
              disabled={posting || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Add note
            </button>
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {notes && notes.some((n) => n.kind === "change") && (
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium dark:bg-slate-800" role="radiogroup" aria-label="Show">
          {(["all", "comment", "change"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={show === v}
              onClick={() => setShow(v)}
              className={`rounded-md px-2.5 py-1 transition-colors ${show === v ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
            >
              {v === "all" ? "Everything" : v === "comment" ? "Notes" : `Changes (${notes.filter((n) => n.kind === "change").length})`}
            </button>
          ))}
        </div>
      )}

      {/* Thread */}
      {notes === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 py-8 text-center dark:border-slate-700">
          <MessageSquareText className="h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">No notes yet</p>
          <p className="text-xs text-slate-500">Notes marked “Only me” are visible just to you.</p>
        </div>
      ) : (
        <ol className="space-y-3">
          {notes.filter((n) => show === "all" || (n.kind ?? "comment") === show).map((n) => {
            const isEditing = editing?.id === n.id;
            const ago = timeAgo(n.created_at);
            if (n.kind === "change") {
              const system = !n.author_membership_id;
              return (
                <li key={n.id} className="flex gap-3">
                  {system ? (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                      <Sparkles className="h-4 w-4" />
                    </span>
                  ) : (
                    <UserAvatar name={n.author_name} src={n.author_avatar} className="mt-0.5 h-8 w-8 shrink-0 text-[10px]" />
                  )}
                  <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">{n.mine ? "You" : n.author_name}</span>
                      <time dateTime={n.created_at} title={ago || undefined} className="text-xs text-slate-500">{formatDateTime(n.created_at)}</time>
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-50 px-1.5 py-px text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        <History className="h-2.5 w-2.5" /> Change
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Action · </span>{n.action}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{system ? "Basis · " : "Comment · "}</span>{n.body}
                    </p>
                  </div>
                </li>
              );
            }
            return (
              <li key={n.id} className="flex gap-3">
                <UserAvatar name={n.author_name} src={n.author_avatar} className="mt-0.5 h-8 w-8 shrink-0 text-[10px]" />
                <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-slate-200 bg-white px-3.5 py-2.5 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{n.mine ? "You" : n.author_name}</span>
                    <time dateTime={n.created_at} title={ago || undefined} className="text-xs text-slate-500">
                      {formatDateTime(n.created_at)}
                    </time>
                    {n.updated_at && (
                      <span className="text-[11px] text-slate-400" title={`Edited ${formatDateTime(n.updated_at)}`}>(edited)</span>
                    )}
                    <span
                      className={`ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ${
                        n.visibility === "private"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                          : "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                      }`}
                    >
                      {n.visibility === "private" ? <Lock className="h-2.5 w-2.5" /> : <Users className="h-2.5 w-2.5" />}
                      {n.visibility === "private" ? "Only me" : "Team"}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-2">
                      <textarea
                        autoFocus
                        aria-label="Edit note"
                        value={editing.body}
                        onChange={(e) => setEditing({ id: n.id, body: e.target.value.slice(0, MAX) })}
                        rows={3}
                        className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!editing.body.trim()}
                          onClick={async () => {
                            if (await update(n.id, { body: editing.body })) setEditing(null);
                          }}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">{n.body}</p>
                  )}

                  {!isEditing && (n.mine || (isAdmin && n.visibility === "team")) && (
                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                      {n.mine && (
                        <>
                          <button type="button" onClick={() => setEditing({ id: n.id, body: n.body })} className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-600">
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => update(n.id, { visibility: n.visibility === "private" ? "team" : "private" })}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-600"
                          >
                            {n.visibility === "private" ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                            {n.visibility === "private" ? "Share with team" : "Make private"}
                          </button>
                        </>
                      )}
                      {confirmDelete === n.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-slate-500">Delete this note?</span>
                          <button type="button" onClick={() => remove(n.id)} className="font-semibold text-red-600 hover:underline">Delete</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="text-slate-500 hover:underline">Keep</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(n.id)} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600">
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
