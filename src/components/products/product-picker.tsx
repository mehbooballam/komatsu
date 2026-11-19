"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Loader2, Package, Boxes, Layers } from "lucide-react";
import { askChangeComment, commentHeader } from "@/components/layout/change-comment";

export interface InventoryProduct { id: string; name: string; model_code: string | null; is_active: boolean }
export interface InventoryFamily { id: string; name: string; state: string; products: InventoryProduct[] | null }
export interface ProductRef { kind: "family" | "product"; id: string; name: string }

/** Product as returned by the alert / group product APIs. */
export interface AttachedProduct {
  key: string;
  kind: "family" | "product";
  id: string;
  name: string;
  family_name: string | null;
  model_code: string | null;
  source?: "alert" | "group";
  state?: string;
  origin?: string;
  group_path?: string[];
}

export const productKey = (kind: "family" | "product", id: string) => `${kind}:${id}`;

/**
 * Attach (or detach) products to alerts. Asks for a comment first (shown in the alerts' Notes);
 * returns false if the person cancels.
 */
export async function setAlertProduct(alertIds: string[], ref: ProductRef, attach: boolean): Promise<boolean> {
  const comment = await askChangeComment({
    action: `${attach ? "Attach" : "Remove"} product ${ref.name}${ref.kind === "family" ? " (whole family)" : ""}`,
    detail: alertIds.length > 1 ? `${alertIds.length} alerts` : undefined,
  });
  if (!comment) return false;
  const res = await fetch("/api/alerts/products", {
    method: attach ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alert_ids: alertIds, [ref.kind === "family" ? "family_id" : "product_id"]: ref.id, comment }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update products");
  return true;
}

/** Attach (or detach) a product to a regulation group. */
export async function setGroupProduct(groupId: string, ref: ProductRef, attach: boolean, groupName?: string): Promise<boolean> {
  const comment = await askChangeComment({
    action: `${attach ? "Attach" : "Remove"} product ${ref.name}${groupName ? ` ${attach ? "to" : "from"} group ${groupName}` : ""}`,
    detail: "Applies to every alert in the group and its sub-groups",
  });
  if (!comment) return false;
  const param = `${ref.kind === "family" ? "family_id" : "product_id"}=${ref.id}`;
  const res = await fetch(attach ? `/api/groups/${groupId}/products` : `/api/groups/${groupId}/products?${param}`, {
    method: attach ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json", ...commentHeader(comment) },
    body: attach ? JSON.stringify({ [ref.kind === "family" ? "family_id" : "product_id"]: ref.id, comment }) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update products");
  return true;
}

/**
 * Checklist of the product inventory (families, each with its models).
 * Ticking attaches, unticking detaches. Products inherited from a group are
 * shown ticked but locked, with where they come from.
 */
export function ProductPicker({
  attached,
  inherited,
  onToggle,
  title = "Attach products",
  attachOnly = false,
}: {
  /** keys ("family:<id>" / "product:<id>") attached directly */
  attached: Set<string>;
  /** key → where it is inherited from, e.g. "EU › REACH" */
  inherited?: Map<string, string>;
  onToggle: (ref: ProductRef, attach: boolean) => Promise<void>;
  title?: string;
  /** Bulk mode: ticking attaches to every selected alert; unticking is not offered. */
  attachOnly?: boolean;
}) {
  const [families, setFamilies] = useState<InventoryFamily[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/products")
      .then((r) => (r.ok ? r.json() : { families: [] }))
      .then((d) => {
        if (cancelled) return;
        setFamilies((d.families || []).filter((f: InventoryFamily) => f.state === "active"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const term = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!families) return [];
    return families
      .map((f) => {
        const models = (f.products || []).filter((p) => p.is_active);
        if (!term) return { f, models };
        const famHit = f.name.toLowerCase().includes(term);
        const hits = models.filter((p) => `${p.name} ${p.model_code || ""}`.toLowerCase().includes(term));
        return famHit || hits.length ? { f, models: famHit ? models : hits } : null;
      })
      .filter(Boolean) as { f: InventoryFamily; models: InventoryProduct[] }[];
  }, [families, term]);

  const toggle = async (ref: ProductRef) => {
    const key = productKey(ref.kind, ref.id);
    if (inherited?.has(key) && !attached.has(key)) return;
    const attach = !attached.has(key);
    if (!attach && attachOnly) return;
    setBusy(key);
    setError(null);
    try {
      await onToggle(ref, attach);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update products");
    } finally {
      setBusy(null);
    }
  };

  const renderRow = (r: ProductRef, label: string, sub?: string | null, indent?: boolean) => {
    const key = productKey(r.kind, r.id);
    const on = attached.has(key);
    const via = !on ? inherited?.get(key) : undefined;
    const checked = on || !!via;
    return (
      <button
        key={key}
        type="button"
        onClick={() => toggle(r)}
        disabled={!!via || busy !== null || (attachOnly && on)}
        title={via ? `Assigned automatically by group ${via} — change it on the group` : undefined}
        className={`flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left text-sm hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800 ${indent ? "pl-9" : "pl-2"}`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            checked
              ? via
                ? "border-slate-300 bg-slate-200 text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                : "border-blue-600 bg-blue-600 text-white"
              : "border-slate-300 dark:border-slate-600"
          }`}
        >
          {busy === key ? <Loader2 className="h-3 w-3 animate-spin" /> : checked && <Check className="h-3 w-3" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${indent ? "" : "font-medium"}`}>{label}</span>
          {(sub || via) && <span className="block truncate text-[11px] text-slate-500">{via ? `Assigned by group ${via}` : sub}</span>}
        </span>
      </button>
    );
  };

  return (
    <div>
      <p className="px-2 py-1.5 text-xs font-semibold text-slate-500">{title}</p>
      {families && families.length > 0 && (
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search families or models…"
          className="mb-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
      )}
      <div className="max-h-72 overflow-y-auto">
        {families === null && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
          </div>
        )}
        {families && families.length === 0 && (
          <div className="px-2 py-4 text-center text-sm text-slate-500">
            <Boxes className="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
            No products yet.
          </div>
        )}
        {families && families.length > 0 && shown.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No matches.</p>}
        {shown.map(({ f, models }) => {
          const expanded = !!term || open.has(f.id);
          return (
            <div key={f.id}>
              <div className="flex items-center">
                <div className="min-w-0 flex-1">
                  {renderRow(
                    { kind: "family", id: f.id, name: f.name },
                    f.name,
                    models.length ? `Whole family · ${models.length} model${models.length > 1 ? "s" : ""}` : "Whole family"
                  )}
                </div>
                {models.length > 0 && !term && (
                  <button
                    type="button"
                    onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                    aria-label={expanded ? `Hide models in ${f.name}` : `Show models in ${f.name}`}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
                  </button>
                )}
              </div>
              {expanded &&
                models.map((p) => renderRow({ kind: "product", id: p.id, name: p.name }, p.name, p.model_code, true))}
            </div>
          );
        })}
      </div>
      {error && <p className="mx-1 mt-1 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      <Link
        href="/products"
        className="mt-1 flex items-center gap-2 border-t border-slate-100 px-2 pb-1 pt-2 text-xs font-medium text-blue-600 hover:text-blue-700 dark:border-slate-800 dark:text-blue-400"
      >
        <Package className="h-3.5 w-3.5" /> Manage products
      </Link>
    </div>
  );
}

/** Picker for one alert: loads what is attached (directly and via groups) and keeps it in sync. */
export function AlertProductsPicker({ alertId, onChanged }: { alertId: string; onChanged?: (msg: string) => void }) {
  const [items, setItems] = useState<AttachedProduct[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts/products?alert_id=${alertId}`)
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => !cancelled && setItems(d.products || []));
    return () => {
      cancelled = true;
    };
  }, [alertId]);
  if (!items) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  return (
    <ProductPicker
      attached={new Set(items.filter((p) => p.source === "alert" && p.state !== "suggested").map((p) => p.key))}
      inherited={new Map(items.filter((p) => p.source === "group").map((p) => [p.key, (p.group_path || []).join(" › ")]))}
      onToggle={async (ref, attach) => {
        if (!(await setAlertProduct([alertId], ref, attach))) return;
        const r = await fetch(`/api/alerts/products?alert_id=${alertId}`);
        if (r.ok) setItems((await r.json()).products || []);
        onChanged?.(attach ? `Attached “${ref.name}”` : `Removed “${ref.name}”`);
      }}
    />
  );
}

/** Picker for several alerts at once: each tick attaches that product to all of them. */
export function BulkProductsPicker({ alertIds, onChanged }: { alertIds: string[]; onChanged?: (msg: string) => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  return (
    <ProductPicker
      title={`Attach to ${alertIds.length} alert${alertIds.length > 1 ? "s" : ""}`}
      attachOnly
      attached={done}
      onToggle={async (ref) => {
        if (!(await setAlertProduct(alertIds, ref, true))) return;
        setDone((s) => new Set(s).add(productKey(ref.kind, ref.id)));
        onChanged?.(`Attached “${ref.name}” to ${alertIds.length} alert${alertIds.length > 1 ? "s" : ""}`);
      }}
    />
  );
}

/** Small chip for an attached product. */
export function ProductChip({
  product,
  onRemove,
}: {
  product: AttachedProduct;
  onRemove?: () => void;
}) {
  const inheritedFrom = product.source === "group" ? product.group_path?.join(" › ") : null;
  // The group it comes from (the group the product is assigned to, which may be a parent group)
  const groupName = product.source === "group" ? product.group_path?.[product.group_path.length - 1] : null;
  const suggested = product.state === "suggested";
  return (
    <span
      title={
        inheritedFrom
          ? `Assigned automatically from group ${inheritedFrom}. To remove it, remove it from the group.`
          : suggested
          ? "Suggested by the import — attach it to confirm"
          : product.family_name && product.kind === "product"
          ? `${product.family_name}${product.model_code ? ` · ${product.model_code}` : ""}`
          : "Whole product family"
      }
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
        suggested
          ? "border border-dashed border-emerald-400 bg-white text-emerald-700 ring-transparent dark:bg-transparent dark:text-emerald-300"
          : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
      }`}
    >
      {product.kind === "family" ? <Boxes className="h-3 w-3 shrink-0" /> : <Package className="h-3 w-3 shrink-0" />}
      <span className="min-w-0 truncate">{product.name}</span>
      {product.kind === "product" && product.model_code && <span className="shrink-0 whitespace-nowrap opacity-60">{product.model_code}</span>}
      {groupName && (
        <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-indigo-100 px-1.5 py-px text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
          <Layers className="h-2.5 w-2.5" /> {groupName}
        </span>
      )}
      {suggested && <span className="shrink-0 whitespace-nowrap opacity-60">· suggested</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${product.name}`}
          className="-mr-1 ml-0.5 shrink-0 rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span aria-hidden className="block h-3 w-3 text-center leading-3">×</span>
        </button>
      )}
    </span>
  );
}
