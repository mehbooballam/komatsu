"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight, ChevronDown, Plus, MoreHorizontal, Pencil, FolderTree, Trash2, Eye, Search, UserPlus, Loader2, X, Layers, Package,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/alerts/confirm-dialog";
import { groupColor, MemberPicker, useAssignables, MAX_GROUP_DEPTH } from "@/components/alerts/alerts-table";
import { UserAvatar } from "@/components/ui/brand";
import { useSessionInfo } from "@/components/layout/session-context";
import { ProductPicker, setGroupProduct, type AttachedProduct } from "@/components/products/product-picker";

interface Group {
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
  /** Products attached directly to this group */
  products: AttachedProduct[];
}

const PRIORITY: Record<string, string> = {
  critical: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
  high: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30",
  moderate: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  low: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30",
};

type FormState = {
  mode: "create" | "edit";
  id?: string;
  title: string;
  parent_group_id: string | null;
  jurisdiction_ref: string;
  issuer: string;
  description: string;
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export default function GroupsPage() {
  const session = useSessionInfo();
  const role = session?.membership.role;
  const canEdit = !!role && role !== "risk_owner";
  const canAssign = role === "company_admin" || role === "manager";

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ id: string; view: "menu" | "owner" | "products" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const { members } = useAssignables(canAssign);

  const load = useCallback(async () => {
    const res = await fetch("/api/groups");
    const data = res.ok ? await res.json() : { groups: [] };
    setGroups(data.groups || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/groups")
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((d) => {
        if (cancelled) return;
        setGroups(d.groups || []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3500);
    return () => clearTimeout(t);
  }, [flash]);

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // Rows to show: hide descendants of collapsed groups; when searching, show matches plus their ancestors
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term) {
      const keep = new Set<string>();
      for (const g of groups) {
        const hay = `${g.title} ${g.issuer || ""} ${g.jurisdiction_ref || ""}`.toLowerCase();
        if (!hay.includes(term)) continue;
        for (let x: Group | undefined = g; x; x = x.parent_group_id ? byId.get(x.parent_group_id) : undefined) keep.add(x.id);
      }
      return groups.filter((g) => keep.has(g.id));
    }
    return groups.filter((g) => {
      for (let p = g.parent_group_id; p; p = byId.get(p)?.parent_group_id ?? null) if (collapsed.has(p)) return false;
      return true;
    });
  }, [groups, byId, collapsed, q]);

  /** Ids a group may not be moved under: itself and its descendants, or parents that would exceed the depth limit. */
  const parentOptions = (editingId?: string) => {
    let height = 1;
    const blocked = new Set<string>();
    if (editingId) {
      const own = [editingId];
      for (let i = 0; i < own.length; i++) for (const g of groups) if (g.parent_group_id === own[i]) own.push(g.id);
      own.forEach((id) => blocked.add(id));
      const self = byId.get(editingId);
      if (self) height = Math.max(...own.map((id) => byId.get(id)?.depth ?? self.depth)) - self.depth + 1;
    }
    return groups.map((g) => ({ g, disabled: blocked.has(g.id) || g.depth + height > MAX_GROUP_DEPTH }));
  };

  const openCreate = (parentId: string | null = null) => {
    setFormError(null);
    setForm({ mode: "create", title: "", parent_group_id: parentId, jurisdiction_ref: "", issuer: "", description: "" });
  };
  const openEdit = (g: Group) => {
    setFormError(null);
    setForm({
      mode: "edit",
      id: g.id,
      title: g.title,
      parent_group_id: g.parent_group_id,
      jurisdiction_ref: g.jurisdiction_ref || "",
      issuer: g.issuer || "",
      description: g.description || "",
    });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(form.mode === "create" ? "/api/groups" : `/api/groups/${form.id}`, {
        method: form.mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          parent_group_id: form.parent_group_id,
          jurisdiction_ref: form.jurisdiction_ref,
          issuer: form.issuer,
          description: form.description,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save group");
      if (form.parent_group_id) setCollapsed((c) => { const n = new Set(c); n.delete(form.parent_group_id!); return n; });
      setFlash({ ok: true, text: form.mode === "create" ? `Created “${form.title.trim()}”` : "Group saved" });
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save group");
    } finally {
      setSaving(false);
    }
  }

  async function setOwner(g: Group, membershipId: string | null) {
    setMenuFor(null);
    const res = await fetch(`/api/groups/${g.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_owner", membership_id: membershipId }),
    });
    setFlash(res.ok ? { ok: true, text: membershipId ? "Owner assigned" : "Owner removed" } : { ok: false, text: "Could not change owner" });
    load();
  }

  /** Products a group gets from its parent groups (shown locked in the picker). */
  const inheritedFor = (g: Group) => {
    const map = new Map<string, string>();
    for (let p = g.parent_group_id ? byId.get(g.parent_group_id) : undefined; p; p = p.parent_group_id ? byId.get(p.parent_group_id) : undefined) {
      for (const x of p.products) if (!map.has(x.key)) map.set(x.key, p.path.join(" › "));
    }
    return map;
  };

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const parentChoices = form ? parentOptions(form.mode === "edit" ? form.id : undefined) : [];
  const formParent = form?.parent_group_id ? byId.get(form.parent_group_id) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Regulation Groups</h1>
        </div>
        {canEdit && (
          <button
            onClick={() => openCreate(null)}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New group
          </button>
        )}
      </div>

      {flash && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"}`}>
          {flash.text}
        </div>
      )}

      <div className="panel overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search groups…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setCollapsed(new Set())} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Expand all
            </button>
            <button
              onClick={() => setCollapsed(new Set(groups.filter((g) => g.child_count > 0).map((g) => g.id)))}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Collapse all
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <FolderTree className="h-6 w-6" />
            </div>
            <p className="mt-3 font-semibold text-slate-900 dark:text-white">No regulation groups yet</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Create a top-level group (e.g. “EU Chemicals”), then add sub-groups such as “REACH › Annex XVII”.
            </p>
            {canEdit && (
              <button onClick={() => openCreate(null)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" /> New group
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-4 py-2.5">Group</th>
                  <th className="px-3 py-2.5 text-right">Alerts</th>
                  <th className="px-3 py-2.5">Top priority</th>
                  <th className="px-3 py-2.5">Owner</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No groups match “{q}”.</td></tr>
                )}
                {visible.map((g) => {
                  const open = !collapsed.has(g.id) || !!q.trim();
                  const color = groupColor(g.path[0]);
                  return (
                    <tr key={g.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-3" style={{ paddingLeft: 12 + (g.depth - 1) * 26 }}>
                        <div className="flex items-center gap-2">
                          {g.child_count > 0 ? (
                            <button
                              onClick={() => toggle(g.id)}
                              aria-label={open ? `Collapse ${g.title}` : `Expand ${g.title}`}
                              aria-expanded={open}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          ) : (
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-300 dark:text-slate-600">
                              {g.depth > 1 ? "└" : "•"}
                            </span>
                          )}
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ${color}`}>
                            <Layers className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/alerts?group_id=${g.id}`} className={`truncate text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-300 ${g.depth === 1 ? "font-semibold" : "font-medium"}`}>
                                {g.title}
                              </Link>
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                L{g.depth}
                              </span>
                            </div>
                            {(g.issuer || g.jurisdiction_ref || g.child_count > 0) && (
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                {[g.jurisdiction_ref, g.issuer, g.child_count > 0 ? `${g.child_count} sub-group${g.child_count > 1 ? "s" : ""}` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                            {g.products.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {g.products.map((p) => (
                                  <span
                                    key={p.key}
                                    title={p.kind === "family" ? "Whole product family" : [p.family_name, p.model_code].filter(Boolean).join(" · ")}
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
                                  >
                                    <Package className="h-3 w-3" /> {p.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className="font-semibold text-slate-900 dark:text-white">{g.total_count}</span>
                        {g.child_count > 0 && g.alert_count !== g.total_count && (
                          <span className="block text-[11px] text-slate-400" title="Filed directly in this group">{g.alert_count} direct</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {g.highest_priority ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${PRIORITY[g.highest_priority]}`}>{g.highest_priority}</span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {g.owner_name ? (
                          <span className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300">
                            <UserAvatar name={g.owner_name} className="h-6 w-6 text-[9px]" />
                            <span className="truncate">{g.owner_name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Popover open={menuFor?.id === g.id} onOpenChange={(o) => setMenuFor(o ? { id: g.id, view: "menu" } : null)}>
                          <PopoverTrigger asChild>
                            <button aria-label={`Actions for ${g.title}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-64 p-1.5">
                            {menuFor?.view === "owner" ? (
                              <MemberPicker members={members} selectedId={g.owner_membership_id} onPick={(id) => setOwner(g, id)} />
                            ) : menuFor?.view === "products" ? (
                              <ProductPicker
                                title={`Products for ${g.title}`}
                                attached={new Set(g.products.map((p) => p.key))}
                                inherited={inheritedFor(g)}
                                onToggle={async (ref, attach) => {
                                  await setGroupProduct(g.id, ref, attach);
                                  setFlash({ ok: true, text: attach ? `Attached “${ref.name}” to ${g.title}` : `Removed “${ref.name}” from ${g.title}` });
                                  await load();
                                }}
                              />
                            ) : (
                              <div className="text-sm">
                                <Link href={`/alerts?group_id=${g.id}`} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                  <Eye className="h-4 w-4 text-slate-500" /> View alerts
                                </Link>
                                {canEdit && g.depth < MAX_GROUP_DEPTH && (
                                  <button onClick={() => { setMenuFor(null); openCreate(g.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <Plus className="h-4 w-4 text-slate-500" /> Add sub-group
                                  </button>
                                )}
                                {canEdit && (
                                  <button onClick={() => { setMenuFor(null); openEdit(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <Pencil className="h-4 w-4 text-slate-500" /> Edit or move
                                  </button>
                                )}
                                {canEdit && (
                                  <button onClick={() => setMenuFor({ id: g.id, view: "products" })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <Package className="h-4 w-4 text-slate-500" /> Attach products
                                  </button>
                                )}
                                {canAssign && (
                                  <button onClick={() => setMenuFor({ id: g.id, view: "owner" })} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <UserPlus className="h-4 w-4 text-slate-500" /> {g.owner_name ? "Change owner" : "Assign owner"}
                                  </button>
                                )}
                                {canEdit && (
                                  <>
                                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                                    <button onClick={() => { setMenuFor(null); setPendingDelete(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                                      <Trash2 className="h-4 w-4" /> Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / edit */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.mode === "edit" ? "Edit group" : formParent ? "New sub-group" : "New group"}
            </DialogTitle>
            <DialogDescription>
              {formParent ? <>Inside <strong>{formParent.path.join(" › ")}</strong></> : "Top-level group"}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label htmlFor="g-title" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input id="g-title" autoFocus required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label htmlFor="g-parent" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Sits inside</label>
                <select
                  id="g-parent"
                  value={form.parent_group_id ?? ""}
                  onChange={(e) => setForm({ ...form, parent_group_id: e.target.value || null })}
                  className={inputCls}
                >
                  <option value="">— Top level —</option>
                  {parentChoices.map(({ g, disabled }) => (
                    <option key={g.id} value={g.id} disabled={disabled}>
                      {"  ".repeat(g.depth - 1)}{g.depth > 1 ? "└ " : ""}{g.title}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">Up to {MAX_GROUP_DEPTH} levels. Greyed-out groups would make the tree too deep{form.mode === "edit" ? " or are inside this group" : ""}.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="g-jur" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Jurisdiction</label>
                  <input id="g-jur" value={form.jurisdiction_ref} onChange={(e) => setForm({ ...form, jurisdiction_ref: e.target.value })} placeholder="e.g. European Union" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="g-iss" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Issuer</label>
                  <input id="g-iss" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="e.g. ECHA" className={inputCls} />
                </div>
              </div>
              <div>
                <label htmlFor="g-desc" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea id="g-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
              </div>
              {formError && (
                <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  <X className="h-4 w-4" /> {formError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  Cancel
                </button>
                <button type="submit" disabled={saving || !form.title.trim()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {form.mode === "edit" ? "Save" : "Create"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.title ?? ""}”?`}
        description={
          pendingDelete && (
            <>
              {pendingDelete.child_count > 0 && <>Its sub-groups are deleted too. </>}
              {pendingDelete.total_count > 0 ? (
                <>
                  The <strong>{pendingDelete.total_count} alert{pendingDelete.total_count > 1 ? "s" : ""}</strong> inside will move to{" "}
                  <strong>
                    {pendingDelete.parent_group_id ? byId.get(pendingDelete.parent_group_id)?.path.join(" › ") : "No group"}
                  </strong>
                  . Alerts themselves are not deleted.
                </>
              ) : (
                <>No alerts are affected.</>
              )}
            </>
          )
        }
        confirmLabel="Delete group"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const g = pendingDelete!;
          const res = await fetch(`/api/groups/${g.id}`, { method: "DELETE" });
          setFlash(res.ok ? { ok: true, text: `Deleted “${g.title}”` } : { ok: false, text: "Could not delete group" });
          await load();
        }}
      />
    </div>
  );
}
