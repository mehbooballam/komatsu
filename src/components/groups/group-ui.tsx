"use client";

import { useState } from "react";
import { Check, ChevronDown, Plus, Tag, UserPlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MemberPicker } from "@/components/alerts/alerts-table";
import { UserAvatar } from "@/components/ui/brand";
import type { AttachedProduct } from "@/components/products/product-picker";
import { IDENTIFIER_LABELS, type GroupingMethod, type IdentifierKind, type VersionType } from "@/lib/grouping/labels";

/* ---------- Types shared by the groups page and the group drawer ---------- */

export type Band = "critical" | "high" | "moderate" | "low" | "unscored";

export interface Group {
  id: string;
  parent_group_id: string | null;
  title: string;
  jurisdiction_ref: string | null;
  issuer: string | null;
  description: string | null;
  owner_membership_id: string | null;
  owner_name: string | null;
  depth: number;
  path: string[];
  alert_count: number;
  total_count: number;
  highest_priority: string | null;
  child_count: number;
  products: AttachedProduct[];
  level: "family" | "action" | null;
  group_key: string | null;
  auto_created: boolean;
  identifiers: Array<{ kind: IdentifierKind; value: string }>;
  /** Highest final score in the group (its risk score) */
  score: number | null;
  by_band: Record<Band, number>;
  next_deadline: string | null;
  needs_review: number;
  labels: string[];
  created_at?: string;
}

/** An alert (a version) filed in a group. */
export interface GroupAlert {
  id: string;
  group_id: string;
  title: string;
  external_alert_id: string | null;
  version_type: VersionType | null;
  grouping_method: GroupingMethod | null;
  grouping_confidence: number | null;
  grouping_reviewed: boolean;
  priority: string | null;
  score: number | null;
  deadline: string | null;
}

export interface GroupLabel { id: string; name: string; color: string }
export interface Member { id: string; display_name: string; email: string; avatar?: string | null }

/* ---------- Styles ---------- */

export const LABEL_STYLE: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
  amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
  rose: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
  teal: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30",
  orange: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/30",
};
export const LABEL_COLORS = Object.keys(LABEL_STYLE);

export const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
  high: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
  moderate: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  low: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30",
};
export const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1 };
export const BAND_ORDER: Band[] = ["critical", "high", "moderate", "low", "unscored"];
export const BAND_COLORS: Record<Band, string> = { critical: "#7c3aed", high: "#dc4a0c", moderate: "#f59e0b", low: "#14b8a6", unscored: "#cbd5e1" };
export const BAND_LABELS: Record<Band, string> = { critical: "Critical", high: "High", moderate: "Moderate", low: "Low", unscored: "Unscored" };

// AI grouping can also record "act" and "other" identifiers (e.g. "Regulation (EU) 2023/1542"), shown as the value alone
export const identText = (i: { kind: IdentifierKind; value: string }) =>
  `${IDENTIFIER_LABELS[i.kind] ?? ""} ${i.kind === "bill" ? i.value.split(" ").slice(1).join(" ") : i.value}`.trim();

export function formatDay(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- Small pieces ---------- */

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || !PRIORITY_STYLE[priority]) return <span className="text-xs text-slate-400">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${PRIORITY_STYLE[priority]}`}>{priority}</span>;
}

/** Thin stacked bar: how the group's alerts split across priorities. */
export function BandBar({ byBand, total, className = "w-20" }: { byBand: Record<Band, number>; total: number; className?: string }) {
  if (!total) return null;
  return (
    <div
      className={`flex h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${className}`}
      title={BAND_ORDER.filter((b) => byBand[b]).map((b) => `${byBand[b]} ${BAND_LABELS[b].toLowerCase()}`).join(", ")}
    >
      {BAND_ORDER.filter((b) => byBand[b] > 0).map((b) => (
        <div key={b} style={{ width: `${(byBand[b] / total) * 100}%`, backgroundColor: BAND_COLORS[b] }} />
      ))}
    </div>
  );
}

export function LabelChip({ name, color, size = "sm" }: { name: string; color: string; size?: "xs" | "sm" }) {
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ring-1 ${size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"} ${LABEL_STYLE[color] || LABEL_STYLE.slate}`}>
      {name}
    </span>
  );
}

/**
 * Checklist of the workspace's labels: tick several, add a new one, then Apply.
 * `onApply` receives the full new list for the group.
 */
export function LabelEditor({
  labels,
  selected,
  onApply,
  onCreate,
}: {
  labels: GroupLabel[];
  selected: string[];
  onApply: (next: string[]) => void;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [name, setName] = useState("");
  const has = (n: string) => draft.some((x) => x.toLowerCase() === n.toLowerCase());
  const changed = draft.length !== selected.length || draft.some((d) => !selected.some((s) => s.toLowerCase() === d.toLowerCase()));

  const create = async () => {
    const made = await onCreate(name);
    if (made) {
      if (!has(made)) setDraft((d) => [...d, made]);
      setName("");
    }
  };

  return (
    <div className="text-sm">
      <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Labels</p>
      <ul className="max-h-56 overflow-y-auto">
        {labels.map((l) => {
          const on = has(l.name);
          return (
            <li key={l.id}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => setDraft((d) => (on ? d.filter((x) => x.toLowerCase() !== l.name.toLowerCase()) : [...d, l.name]))}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                  {on && <Check className="h-3 w-3" />}
                </span>
                <LabelChip name={l.name} color={l.color} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center gap-1.5 border-t border-slate-100 px-1.5 pt-2 dark:border-slate-800">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="New label…"
          aria-label="New label name"
          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!name.trim()}
          aria-label="Add label"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex justify-end px-1.5 pb-0.5">
        <button
          type="button"
          disabled={!changed}
          onClick={() => onApply(draft)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/**
 * Labels for several groups at once. Each label shows whether all, some or none
 * of the selected groups have it; click to add it to all or remove it from all.
 * Labels left untouched stay as they are on each group.
 */
export function BulkLabelEditor({
  labels,
  groups,
  onApply,
  onCreate,
}: {
  labels: GroupLabel[];
  groups: Group[];
  onApply: (add: string[], remove: string[]) => void;
  onCreate: (name: string) => Promise<string | null>;
}) {
  // undefined = leave as is, true = add to all, false = remove from all
  const [choice, setChoice] = useState<Map<string, boolean>>(new Map());
  const [name, setName] = useState("");
  const key = (n: string) => n.toLowerCase();
  const countWith = (n: string) => groups.filter((g) => g.labels.some((x) => key(x) === key(n))).length;
  const add = labels.filter((l) => choice.get(key(l.name)) === true).map((l) => l.name);
  const remove = labels.filter((l) => choice.get(key(l.name)) === false).map((l) => l.name);

  const original = (n: string) => {
    const have = countWith(n);
    return have === groups.length ? "all" : have === 0 ? "none" : "some";
  };
  // Click cycles: mixed → add to all → remove from all → back to mixed; all ⇄ none otherwise
  const cycle = (n: string) =>
    setChoice((m) => {
      const k = key(n);
      const orig = original(n);
      const shown = m.has(k) ? (m.get(k) ? "all" : "none") : orig;
      const nextState = shown === "all" ? "none" : shown === "none" ? (orig === "some" && m.has(k) ? "some" : "all") : "all";
      const next = new Map(m);
      if (nextState === orig) next.delete(k);
      else next.set(k, nextState === "all");
      return next;
    });

  const create = async () => {
    const made = await onCreate(name);
    if (made) {
      setChoice((m) => new Map(m).set(key(made), true));
      setName("");
    }
  };

  return (
    <div className="text-sm">
      <p className="px-2.5 py-1.5 text-xs font-semibold text-slate-500">Labels on {groups.length} group{groups.length === 1 ? "" : "s"}</p>
      <ul className="max-h-56 overflow-y-auto">
        {labels.map((l) => {
          const have = countWith(l.name);
          const c = choice.get(key(l.name));
          const state = c === true ? "all" : c === false ? "none" : have === groups.length ? "all" : have === 0 ? "none" : "some";
          return (
            <li key={l.id}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={state === "all" ? true : state === "none" ? false : "mixed"}
                onClick={() => cycle(l.name)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${state === "none" ? "border-slate-300 dark:border-slate-600" : "border-blue-600 bg-blue-600 text-white"}`}>
                  {state === "all" && <Check className="h-3 w-3" />}
                  {state === "some" && <span className="h-0.5 w-2 rounded bg-white" />}
                </span>
                <LabelChip name={l.name} color={l.color} />
                <span className="ml-auto text-[11px] text-slate-400">
                  {c === true ? "add" : c === false ? "remove" : `${have}/${groups.length}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center gap-1.5 border-t border-slate-100 px-1.5 pt-2 dark:border-slate-800">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="New label…"
          aria-label="New label name"
          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={!name.trim()}
          aria-label="Add label"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1.5 pb-0.5">
        <span className="text-[11px] text-slate-500">
          {add.length || remove.length ? [add.length ? `+${add.length}` : null, remove.length ? `−${remove.length}` : null].filter(Boolean).join(" ") : "Click a label to add or remove it"}
        </span>
        <button
          type="button"
          disabled={!add.length && !remove.length}
          onClick={() => onApply(add, remove)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/** Labels on a group, with a button that opens the editor. */
export function GroupLabels({
  group,
  labels,
  canEdit,
  onApply,
  onCreate,
  max = 3,
  alwaysShowEdit = false,
}: {
  group: Group;
  labels: GroupLabel[];
  canEdit: boolean;
  onApply: (next: string[]) => void;
  onCreate: (name: string) => Promise<string | null>;
  max?: number;
  /** Show the edit button even when the group has labels (in the drawer, which has no row hover) */
  alwaysShowEdit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const color = (n: string) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.color || "slate";
  const shown = group.labels.slice(0, max);
  const more = group.labels.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((l) => <LabelChip key={l} name={l} color={color(l)} size="xs" />)}
      {more > 0 && <span className="text-[10px] font-medium text-slate-500" title={group.labels.slice(max).join(", ")}>+{more}</span>}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Labels for ${group.title}`}
              title="Add or remove labels"
              className={`${group.labels.length && !alwaysShowEdit ? "hidden group-hover:inline-flex group-focus-within:inline-flex" : "inline-flex"} items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-1.5 py-px text-[10px] font-medium text-slate-400 transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-600`}
            >
              <Tag className="h-2.5 w-2.5" /> {group.labels.length ? "Edit" : "Label"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1.5" onClick={(e) => e.stopPropagation()}>
            <LabelEditor
              labels={labels}
              selected={group.labels}
              onCreate={onCreate}
              onApply={(next) => {
                setOpen(false);
                onApply(next);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/** Owner cell: shows the owner and, for people who can assign, opens the member picker (as in Alerts). */
export function OwnerPicker({
  ownerId,
  ownerName,
  members,
  canAssign,
  onPick,
  compact = false,
}: {
  /** Name hidden on small screens (table cells) */
  compact?: boolean;
  ownerId: string | null;
  ownerName: string | null;
  members: Member[];
  canAssign: boolean;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const avatar = members.find((m) => m.id === ownerId)?.avatar;
  if (!canAssign) {
    return ownerName ? (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-slate-700 dark:text-slate-300">
        <UserAvatar name={ownerName} src={avatar} className="h-6 w-6 text-[10px]" /> {ownerName}
      </span>
    ) : (
      <span className="text-[11px] text-slate-400">Unassigned</span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {ownerName ? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center gap-2 whitespace-nowrap rounded-full py-0.5 pl-0.5 pr-2.5 text-[13px] text-slate-700 ring-1 ring-transparent transition hover:bg-white hover:ring-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:ring-slate-700"
            title="Change owner"
          >
            <UserAvatar name={ownerName} src={avatar} className="h-6 w-6 text-[10px]" />
            <span className={`truncate ${compact ? "hidden sm:inline" : ""}`}>{ownerName}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 opacity-50 ${compact ? "hidden sm:block" : ""}`} />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-600 dark:hover:bg-blue-500/10"
          >
            <UserPlus className="h-3 w-3" /> <span className={compact ? "hidden sm:inline" : ""}>Assign</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5" onClick={(e) => e.stopPropagation()}>
        <MemberPicker
          members={members}
          selectedId={ownerId}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
