"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus, Search, ChevronRight, MoreHorizontal, Pencil, Trash2, Archive, ArchiveRestore, Boxes, Package, Loader2, X, Bell, Layers, AlertTriangle,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/alerts/confirm-dialog";
import { useSessionInfo } from "@/components/layout/session-context";
import { canMakeChanges, hasCompanyWideAccess } from "@/lib/auth/permissions";

interface Model {
  id: string;
  model_code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  alert_count: number | null;
  alert_confirmed?: number | null;
  group_count: number | null;
}

interface Family {
  id: string;
  name: string;
  description: string | null;
  state: "active" | "archived";
  alert_count: number | null;
  alert_confirmed?: number | null;
  group_count: number | null;
  products: Model[];
}

type FamilyForm = { id?: string; name: string; description: string };
type ModelForm = { id?: string; familyId: string; name: string; model_code: string; description: string; moveTo: string };
type PendingDelete = { kind: "family"; family: Family } | { kind: "model"; family: Family; model: Model };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const menuItem = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800";

/** Column widths shared by the header and the rows */
const COL_ALERTS = "w-40 shrink-0";
const COL_GROUPS = "w-20 shrink-0";

/** Alerts linked to a family or model: opens the Alerts list filtered to it. */
function AlertsCell({ refKey, name, total, confirmed }: { refKey: string; name: string; total: number | null; confirmed?: number | null }) {
  if (total === null) return <span className={COL_ALERTS} />;
  if (!total) return <span className={`${COL_ALERTS} text-right text-xs text-slate-400`}>—</span>;
  const conf = confirmed ?? 0;
  const sugg = total - conf;
  return (
    <span className={`${COL_ALERTS} text-right`}>
      <Link
        href={`/alerts?product=${refKey}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-slate-900 hover:bg-blue-50 hover:text-blue-700 dark:text-white dark:hover:bg-blue-500/10 dark:hover:text-blue-300"
        title={`Show the ${total} alerts linked to ${name}`}
      >
        <Bell className="h-3.5 w-3.5 text-slate-400" /> {total}
      </Link>
      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
        {conf === 0 ? "all suggested" : sugg === 0 ? "all confirmed" : `${conf} confirmed · ${sugg} suggested`}
      </span>
    </span>
  );
}

function GroupsCell({ total }: { total: number | null }) {
  if (total === null) return <span className={COL_GROUPS} />;
  return (
    <span className={`${COL_GROUPS} text-right text-sm tabular-nums ${total ? "font-medium text-slate-700 dark:text-slate-200" : "text-xs text-slate-400"}`} title="Regulation groups this is attached to">
      {total ? <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5 text-slate-400" /> {total}</span> : "—"}
    </span>
  );
}

export default function ProductsPage() {
  const session = useSessionInfo();
  const role = session?.membership.role;
  const canEdit = !!session && canMakeChanges(session.membership.role) && hasCompanyWideAccess(session.membership.role, session.membership.access_scope);
  const canDelete = role === "company_admin" || role === "manager";

  const [families, setFamilies] = useState<Family[]>([]);
  // Product names in imported alerts that the inventory does not have yet
  const [unmatched, setUnmatched] = useState<Array<{ label: string; alerts: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [familyForm, setFamilyForm] = useState<FamilyForm | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/products");
    const data = res.ok ? await res.json() : { families: [] };
    setFamilies(data.families || []);
    setUnmatched(data.unmatched || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : { families: [] }))
      .then((d) => {
        if (cancelled) return;
        setFamilies(d.families || []);
        setUnmatched(d.unmatched || []);
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

  const term = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      families
        .filter((f) => showArchived || f.state === "active")
        .map((f) => {
          if (!term) return { f, models: f.products };
          const famHit = `${f.name} ${f.description || ""}`.toLowerCase().includes(term);
          const hits = f.products.filter((p) => `${p.name} ${p.model_code || ""}`.toLowerCase().includes(term));
          return famHit || hits.length ? { f, models: famHit ? f.products : hits } : null;
        })
        .filter(Boolean) as { f: Family; models: Model[] }[],
    [families, term, showArchived]
  );
  const archivedCount = families.filter((f) => f.state === "archived").length;
  const totalModels = families.reduce((s, f) => s + f.products.length, 0);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong");
    return data;
  }

  async function saveFamily(e: React.FormEvent) {
    e.preventDefault();
    if (!familyForm) return;
    setSaving(true);
    setFormError(null);
    try {
      const body = { name: familyForm.name, description: familyForm.description };
      let linked = 0;
      if (familyForm.id) await call(`/api/products/${familyForm.id}`, "PUT", body);
      else linked = (await call("/api/products", "POST", body))?.matched?.linked ?? 0;
      setFlash({
        ok: true,
        text: familyForm.id
          ? "Family saved"
          : `Added “${familyForm.name.trim()}”${linked ? ` and suggested it on ${linked} imported alert${linked === 1 ? "" : "s"}` : ""}`,
      });
      setFamilyForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function saveModel(e: React.FormEvent) {
    e.preventDefault();
    if (!modelForm) return;
    setSaving(true);
    setFormError(null);
    try {
      const body = { name: modelForm.name, model_code: modelForm.model_code, description: modelForm.description };
      if (modelForm.id) {
        await call(`/api/products/${modelForm.familyId}/models/${modelForm.id}`, "PUT", {
          ...body,
          ...(modelForm.moveTo !== modelForm.familyId ? { family_id: modelForm.moveTo } : {}),
        });
      } else {
        await call(`/api/products/${modelForm.familyId}`, "PUT", { action: "add_product", ...body });
      }
      setExpanded((s) => new Set(s).add(modelForm.moveTo || modelForm.familyId));
      setFlash({ ok: true, text: modelForm.id ? "Product saved" : `Added “${modelForm.name.trim()}”` });
      setModelForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function quick(label: string, fn: () => Promise<unknown>) {
    setMenu(null);
    try {
      await fn();
      setFlash({ ok: true, text: label });
      await load();
    } catch (err) {
      setFlash({ ok: false, text: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openFamily = (f?: Family, presetName = "") => {
    setFormError(null);
    setFamilyForm(f ? { id: f.id, name: f.name, description: f.description || "" } : { name: presetName, description: "" });
  };
  const openModel = (f: Family, m?: Model) => {
    setFormError(null);
    setMenu(null);
    setModelForm({
      id: m?.id,
      familyId: f.id,
      moveTo: f.id,
      name: m?.name || "",
      model_code: m?.model_code || "",
      description: m?.description || "",
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Products</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {families.length} famil{families.length === 1 ? "y" : "ies"} · {totalModels} model{totalModels === 1 ? "" : "s"}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => openFamily()}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Add family
          </button>
        )}
      </div>

      {unmatched.length > 0 && (
        <section className="panel border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Imported products not added yet</h2>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                These alerts were left untagged. Create the family (alerts are then linked automatically as suggestions), or tag the alerts yourself from the Alerts page.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {unmatched.map((u) => (
                  <li key={u.label} className="inline-flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-amber-200 dark:bg-slate-900 dark:ring-amber-500/30">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{u.label}</span>
                    <span className="text-xs text-slate-500">{u.alerts} alert{u.alerts === 1 ? "" : "s"}</span>
                    {canEdit && (
                      <button
                        onClick={() => openFamily(undefined, u.label)}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Plus className="h-3 w-3" /> Create family
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

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
              placeholder="Search families, models or model codes…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          {archivedCount > 0 && (
            <label className="flex items-center gap-2 px-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-blue-600" />
              Show archived ({archivedCount})
            </label>
          )}
        </div>

        {loading ? (
          <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />)}</div>
        ) : families.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <Boxes className="h-6 w-6" />
            </div>
            <p className="mt-3 font-semibold text-slate-900 dark:text-white">No product families yet</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Add a family (e.g. “Hydraulic Excavators”), then add its models so you can attach them to alerts and groups.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing matches “{q}”.</p>
        ) : (
          <>
          <div className="hidden items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:flex dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            <span className="w-7 shrink-0" />
            <span className="min-w-0 flex-1 pl-12">Product family / model</span>
            <span className={`${COL_ALERTS} text-right`} title="Alerts linked to the product: suggested from the import file's Product column, or confirmed by a person. Click a number to see them.">Alerts</span>
            <span className={`${COL_GROUPS} text-right`}>Groups</span>
            {canEdit && <span className="w-7 shrink-0" />}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map(({ f, models }) => {
              const open = !!term || expanded.has(f.id);
              const archived = f.state === "archived";
              return (
                <li key={f.id} className={archived ? "bg-slate-50/60 dark:bg-slate-900/30" : ""}>
                  {/* Family row */}
                  <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <button
                      onClick={() => toggle(f.id)}
                      aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`}
                      aria-expanded={open}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
                    </button>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
                      <Boxes className="h-4 w-4" />
                    </span>
                    <button onClick={() => toggle(f.id)} className="min-w-0 flex-1 text-left">
                      <span className="flex items-center gap-2">
                        <span className={`truncate font-semibold ${archived ? "text-slate-500" : "text-slate-900 dark:text-white"}`}>{f.name}</span>
                        {archived && <span className="rounded bg-slate-200 px-1.5 py-px text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">Archived</span>}
                      </span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {f.products.length} model{f.products.length === 1 ? "" : "s"}
                        {f.alert_count ? <span className="sm:hidden"> · {f.alert_count} alerts</span> : null}
                        {f.description ? ` · ${f.description}` : ""}
                      </span>
                    </button>
                    <span className="hidden items-center gap-3 sm:flex">
                      <AlertsCell refKey={`family:${f.id}`} name={f.name} total={f.alert_count} confirmed={f.alert_confirmed} />
                      <GroupsCell total={f.group_count} />
                    </span>
                    {canEdit && (
                      <Popover open={menu === f.id} onOpenChange={(o) => setMenu(o ? f.id : null)}>
                        <PopoverTrigger asChild>
                          <button aria-label={`Actions for ${f.name}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-56 p-1.5">
                          <button className={menuItem} onClick={() => openModel(f)}>
                            <Plus className="h-4 w-4 text-slate-500" /> Add model
                          </button>
                          <button className={menuItem} onClick={() => { setMenu(null); openFamily(f); }}>
                            <Pencil className="h-4 w-4 text-slate-500" /> Edit family
                          </button>
                          <button
                            className={menuItem}
                            onClick={() =>
                              quick(archived ? `Restored “${f.name}”` : `Archived “${f.name}”`, () =>
                                call(`/api/products/${f.id}`, "PUT", { state: archived ? "active" : "archived" })
                              )
                            }
                          >
                            {archived ? <ArchiveRestore className="h-4 w-4 text-slate-500" /> : <Archive className="h-4 w-4 text-slate-500" />}
                            {archived ? "Restore" : "Archive"}
                          </button>
                          {canDelete && (
                            <>
                              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                              <button className={`${menuItem} text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10`} onClick={() => { setMenu(null); setPendingDelete({ kind: "family", family: f }); }}>
                                <Trash2 className="h-4 w-4" /> Delete family
                              </button>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  {/* Models */}
                  {open && (
                    <div className="border-t border-slate-100 bg-slate-50/70 px-3 pb-3 pt-2 sm:pl-[4.25rem] sm:pr-4 dark:border-slate-800 dark:bg-slate-900/40">
                      {models.length === 0 ? (
                        <p className="py-2 text-sm text-slate-500">No models in this family yet.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {models.map((m) => (
                            <li key={m.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70 dark:bg-slate-800/60 dark:ring-slate-700/60">
                              <Package className={`h-4 w-4 shrink-0 ${m.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-2 text-sm">
                                  <span className={`truncate font-medium ${m.is_active ? "text-slate-900 dark:text-white" : "text-slate-500"}`}>{m.name}</span>
                                  {m.model_code && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-mono text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{m.model_code}</span>}
                                  {!m.is_active && <span className="shrink-0 text-[11px] text-slate-400">Inactive</span>}
                                </p>
                                {m.description && <p className="truncate text-xs text-slate-500">{m.description}</p>}
                              </div>
                              <span className="hidden items-center gap-3 sm:flex">
                                <AlertsCell refKey={`model:${m.id}`} name={m.name} total={m.alert_count} confirmed={m.alert_confirmed} />
                                <GroupsCell total={m.group_count} />
                              </span>
                              {canEdit && (
                                <Popover open={menu === m.id} onOpenChange={(o) => setMenu(o ? m.id : null)}>
                                  <PopoverTrigger asChild>
                                    <button aria-label={`Actions for ${m.name}`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent align="end" className="w-52 p-1.5">
                                    <button className={menuItem} onClick={() => openModel(f, m)}>
                                      <Pencil className="h-4 w-4 text-slate-500" /> Edit
                                    </button>
                                    <button
                                      className={menuItem}
                                      onClick={() =>
                                        quick(m.is_active ? `Deactivated “${m.name}”` : `Activated “${m.name}”`, () =>
                                          call(`/api/products/${f.id}/models/${m.id}`, "PUT", { is_active: !m.is_active })
                                        )
                                      }
                                    >
                                      {m.is_active ? <Archive className="h-4 w-4 text-slate-500" /> : <ArchiveRestore className="h-4 w-4 text-slate-500" />}
                                      {m.is_active ? "Mark inactive" : "Mark active"}
                                    </button>
                                    {canDelete && (
                                      <>
                                        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                                        <button className={`${menuItem} text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10`} onClick={() => { setMenu(null); setPendingDelete({ kind: "model", family: f, model: m }); }}>
                                          <Trash2 className="h-4 w-4" /> Delete
                                        </button>
                                      </>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canEdit && !term && (
                        <button onClick={() => openModel(f)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10">
                          <Plus className="h-4 w-4" /> Add model
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        )}
      </div>

      {/* Family form */}
      <Dialog open={!!familyForm} onOpenChange={(o) => !o && setFamilyForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{familyForm?.id ? "Edit product family" : "New product family"}</DialogTitle>
            <DialogDescription>A family groups related models, e.g. “Hydraulic Excavators”.</DialogDescription>
          </DialogHeader>
          {familyForm && (
            <form onSubmit={saveFamily} className="space-y-4">
              <div>
                <label htmlFor="f-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input id="f-name" autoFocus required maxLength={120} value={familyForm.name} onChange={(e) => setFamilyForm({ ...familyForm, name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label htmlFor="f-desc" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea id="f-desc" rows={2} value={familyForm.description} onChange={(e) => setFamilyForm({ ...familyForm, description: e.target.value })} className={inputCls} />
              </div>
              {formError && <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"><X className="h-4 w-4" /> {formError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setFamilyForm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={saving || !familyForm.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} {familyForm.id ? "Save" : "Create"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Model form */}
      <Dialog open={!!modelForm} onOpenChange={(o) => !o && setModelForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{modelForm?.id ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>In {families.find((f) => f.id === modelForm?.familyId)?.name}</DialogDescription>
          </DialogHeader>
          {modelForm && (
            <form onSubmit={saveModel} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <div>
                  <label htmlFor="m-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                  <input id="m-name" autoFocus required maxLength={120} value={modelForm.name} onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })} placeholder="e.g. PC210LC-11" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="m-code" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Model code</label>
                  <input id="m-code" maxLength={60} value={modelForm.model_code} onChange={(e) => setModelForm({ ...modelForm, model_code: e.target.value })} placeholder="Optional" className={inputCls} />
                </div>
              </div>
              {modelForm.id && (
                <div>
                  <label htmlFor="m-family" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Family</label>
                  <select id="m-family" value={modelForm.moveTo} onChange={(e) => setModelForm({ ...modelForm, moveTo: e.target.value })} className={inputCls}>
                    {families.map((f) => <option key={f.id} value={f.id}>{f.name}{f.state === "archived" ? " (archived)" : ""}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="m-desc" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea id="m-desc" rows={2} value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} className={inputCls} />
              </div>
              {formError && <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"><X className="h-4 w-4" /> {formError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModelForm(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={saving || !modelForm.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} {modelForm.id ? "Save" : "Add"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.kind === "family" ? `Delete “${pendingDelete.family.name}”?` : `Delete “${pendingDelete?.kind === "model" ? pendingDelete.model.name : ""}”?`}
        description={
          pendingDelete && (() => {
            const item = pendingDelete.kind === "family" ? pendingDelete.family : pendingDelete.model;
            const alerts = item.alert_count ?? 0;
            const groups = item.group_count ?? 0;
            const models = pendingDelete.kind === "family" ? pendingDelete.family.products.length : 0;
            return (
              <>
                This permanently deletes {pendingDelete.kind === "family" ? "the family" : "this product"}
                {models > 0 && <> and its <strong>{models} model{models > 1 ? "s" : ""}</strong></>}.{" "}
                {alerts + groups > 0 ? (
                  <>It will be removed from <strong>{alerts} alert{alerts === 1 ? "" : "s"}</strong>{groups > 0 && <> and <strong>{groups} group{groups === 1 ? "" : "s"}</strong></>}. The alerts themselves are kept.</>
                ) : (
                  <>It isn&apos;t attached to any alerts or groups.</>
                )}
                {pendingDelete.kind === "family" && <> To hide it without losing links, use <strong>Archive</strong> instead.</>}
              </>
            );
          })()
        }
        confirmLabel="Delete"
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const p = pendingDelete!;
          const url = p.kind === "family" ? `/api/products/${p.family.id}` : `/api/products/${p.family.id}/models/${p.model.id}`;
          const name = p.kind === "family" ? p.family.name : p.model.name;
          try {
            await call(url, "DELETE");
            setFlash({ ok: true, text: `Deleted “${name}”` });
          } catch (err) {
            setFlash({ ok: false, text: err instanceof Error ? err.message : "Could not delete" });
          }
          await load();
        }}
      />
    </div>
  );
}
