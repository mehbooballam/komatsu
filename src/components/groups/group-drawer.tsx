"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  X, Layers, Pencil, Plus, Trash2, ExternalLink, CalendarClock, Package, Sparkles, AlertTriangle, CheckCircle2,
  ChevronRight, Fingerprint, MoreHorizontal, FolderTree,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProductChip, ProductPicker, setGroupProduct } from "@/components/products/product-picker";
import { MAX_GROUP_DEPTH } from "@/components/alerts/alerts-table";
import { LEVEL_LABELS, METHOD_LABELS, VERSION_LABELS } from "@/lib/grouping/labels";
import {
  BAND_COLORS, BAND_LABELS, BAND_ORDER, BandBar, GroupLabels, OwnerPicker, PriorityBadge, formatDay, identText,
  type Group, type GroupAlert, type GroupLabel, type Member,
} from "@/components/groups/group-ui";

type Tab = "overview" | "versions" | "subgroups";

export interface GroupDrawerProps {
  group: Group;
  groups: Group[];
  alerts: GroupAlert[];
  labels: GroupLabel[];
  members: Member[];
  canEdit: boolean;
  /** Deleting groups is switched on in Settings › Workspace */
  canDelete?: boolean;
  canAssign: boolean;
  /** Tab to open on (e.g. "versions" when the alert count was clicked) */
  initialTab?: Tab;
  /** True while something is open on top (an alert); Escape is left to it */
  paused?: boolean;
  onClose: () => void;
  onOpenGroup: (id: string, tab?: Tab) => void;
  onOpenAlert: (id: string) => void;
  onEdit: (g: Group) => void;
  onAddSub: (g: Group) => void;
  onDelete: (g: Group) => void;
  onSetOwner: (g: Group, id: string | null) => void;
  onSetLabels: (g: Group, labels: string[]) => void;
  onCreateLabel: (name: string) => Promise<string | null>;
  onDecide: (alert: GroupAlert, decision: "confirm" | "reject") => void;
  onChanged: (text: string) => void;
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700/70 dark:bg-slate-900/40">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{children}</div>
    </div>
  );
}

/** One alert (version) row. */
function VersionRow({ a, onOpen }: { a: GroupAlert; onOpen: () => void }) {
  const pending = (a.grouping_method === "similarity" || a.grouping_method === "ai") && !a.grouping_reviewed;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
      <span className="w-24 shrink-0 truncate rounded bg-emerald-50 px-1.5 py-0.5 text-center text-[10px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" title="Version type">
        {a.version_type ? VERSION_LABELS[a.version_type] : "Version"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-800 dark:text-slate-100" title={a.title}>{a.title}</span>
        <span className="block truncate text-[11px] text-slate-500">
          {a.grouping_method ? METHOD_LABELS[a.grouping_method] : "Grouped earlier"}
          {a.grouping_confidence ? ` · ${a.grouping_confidence}%` : ""}
          {pending && <span className="font-semibold text-amber-600"> · needs review</span>}
          {a.deadline && ` · due ${formatDay(a.deadline)}`}
        </span>
      </span>
      <PriorityBadge priority={a.priority} />
      <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{a.score ?? "—"}</span>
    </button>
  );
}

/**
 * Details of one regulation group (family, action or free-form): everything that
 * doesn't fit in the table — key, identifiers, labels, owner, priority mix,
 * products, its versions and its sub-groups.
 */
export function GroupDrawer(props: GroupDrawerProps) {
  const { group: g, groups, alerts, labels, members, canEdit, canAssign, paused, onClose } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, onClose]);

  const byId = useMemo(() => new Map(groups.map((x) => [x.id, x])), [groups]);
  const children = groups.filter((x) => x.parent_group_id === g.id);
  // Every group in this subtree, in tree order
  const subtree = useMemo(() => {
    const out: Group[] = [];
    const walk = (id: string) => {
      const node = byId.get(id);
      if (!node) return;
      out.push(node);
      for (const c of groups.filter((x) => x.parent_group_id === id)) walk(c.id);
    };
    walk(g.id);
    return out;
  }, [g.id, groups, byId]);
  const sections = subtree
    .map((node) => ({ node, items: alerts.filter((a) => a.group_id === node.id) }))
    .filter((s) => s.items.length > 0);
  const pending = sections.flatMap((s) => s.items).filter((a) => (a.grouping_method === "similarity" || a.grouping_method === "ai") && !a.grouping_reviewed);
  const ancestors = g.path.slice(0, -1).map((title, i) => {
    let node: Group | undefined = g;
    for (let k = g.path.length - 1; k > i && node; k--) node = node.parent_group_id ? byId.get(node.parent_group_id) : undefined;
    return { title, id: node?.id };
  });

  // Products this group gets from its parent groups (shown locked in the picker)
  const inherited = new Map<string, string>();
  for (let p = g.parent_group_id ? byId.get(g.parent_group_id) : undefined; p; p = p.parent_group_id ? byId.get(p.parent_group_id) : undefined) {
    for (const x of p.products) if (!inherited.has(x.key)) inherited.set(x.key, p.path.join(" › "));
  }

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "overview", label: "Overview" },
    { key: "versions", label: "Versions", count: g.total_count },
    { key: "subgroups", label: "Sub-groups", count: g.child_count },
  ];

  return (
    <>
      <div className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Group ${g.title}`}
        className="fixed inset-y-0 right-0 z-[35] flex w-full max-w-2xl flex-col bg-[var(--background)] shadow-2xl animate-in slide-in-from-right"
      >
        {/* Header */}
        <header className="border-b border-slate-200 px-5 pb-0 pt-4 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {ancestors.length > 0 && (
                <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500" aria-label="Parent groups">
                  {ancestors.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && <ChevronRight className="h-3 w-3" />}
                      {a.id ? (
                        <button type="button" onClick={() => props.onOpenGroup(a.id!)} className="hover:text-blue-600 hover:underline">{a.title}</button>
                      ) : a.title}
                    </span>
                  ))}
                  <ChevronRight className="h-3 w-3" />
                </nav>
              )}
              <h2 className="text-lg font-semibold leading-snug text-slate-900 dark:text-white">{g.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${g.level === "family" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : g.level === "action" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                  {g.level ? LEVEL_LABELS[g.level] : `Group · level ${g.depth}`}
                </span>
                {g.group_key && <code className="rounded bg-slate-100 px-1.5 py-px text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{g.group_key}</code>}
                {g.auto_created && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <Sparkles className="h-3 w-3" /> Created automatically
                  </span>
                )}
                <GroupLabels group={g} labels={labels} canEdit={canEdit} max={8} alwaysShowEdit onApply={(next) => props.onSetLabels(g, next)} onCreate={props.onCreateLabel} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && (
                <button onClick={() => props.onEdit(g)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              )}
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                  <button aria-label="More actions" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1.5 text-sm">
                  <Link href={`/alerts?group_id=${g.id}`} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <ExternalLink className="h-4 w-4 text-slate-500" /> Open in Alerts
                  </Link>
                  {canEdit && g.depth < MAX_GROUP_DEPTH && (
                    <button onClick={() => { setMenuOpen(false); props.onAddSub(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <Plus className="h-4 w-4 text-slate-500" /> {g.level === "family" ? "Add action" : "Add sub-group"}
                    </button>
                  )}
                  {canEdit && props.canDelete && (
                    <>
                      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                      <button onClick={() => { setMenuOpen(false); props.onDelete(g); }} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                        <Trash2 className="h-4 w-4" /> Delete group
                      </button>
                    </>
                  )}
                </PopoverContent>
              </Popover>
              <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <nav className="mt-3 flex gap-1" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.key ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.count}</span>
                )}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Alerts">
                  {g.total_count}
                  {g.child_count > 0 && g.alert_count !== g.total_count && <span className="ml-1 text-xs font-normal text-slate-500">({g.alert_count} direct)</span>}
                </Stat>
                <Stat label="Priority"><PriorityBadge priority={g.highest_priority} /></Stat>
                <Stat label="Score">{g.score ?? <span className="font-normal text-slate-400">—</span>}</Stat>
                <Stat label="Next deadline">
                  {g.next_deadline ? (
                    <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-400" /> {formatDay(g.next_deadline)}</span>
                  ) : <span className="font-normal text-slate-400">—</span>}
                </Stat>
              </div>

              {pending.length > 0 && (
                <Section title={`Needs review (${pending.length})`}>
                  <p className="mb-2 text-xs text-slate-500">Grouped by similar subject. Confirm they belong here, or reject to take them out.</p>
                  <ul className="space-y-2">
                    {pending.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs dark:bg-amber-500/10">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <button type="button" onClick={() => props.onOpenAlert(a.id)} className="min-w-0 flex-1 truncate text-left font-medium text-slate-800 hover:underline dark:text-slate-100" title={a.title}>
                          {a.title} <span className="font-normal text-slate-500">· {a.grouping_confidence}%</span>
                        </button>
                        {canEdit && (
                          <span className="flex shrink-0 gap-1">
                            <button onClick={() => props.onDecide(a, "confirm")} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50 dark:bg-slate-900">
                              <CheckCircle2 className="h-3 w-3" /> Confirm
                            </button>
                            <button onClick={() => props.onDecide(a, "reject")} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 dark:bg-slate-900">
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="Owner">
                <div className="flex items-center justify-between gap-3">
                  <OwnerPicker ownerId={g.owner_membership_id} ownerName={g.owner_name} members={members} canAssign={canAssign} onPick={(id) => props.onSetOwner(g, id)} />
                  <p className="text-right text-xs text-slate-500">Alerts in this group without their own owner follow the group owner.</p>
                </div>
              </Section>

              <Section title="Details">
                <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-slate-500">Jurisdiction</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{g.jurisdiction_ref || "—"}</dd>
                  <dt className="text-slate-500">Issuing authority</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{g.issuer || "—"}</dd>
                  <dt className="text-slate-500">Identifiers</dt>
                  <dd>
                    {g.identifiers.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {g.identifiers.map((i) => (
                          <span key={`${i.kind}:${i.value}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            <Fingerprint className="h-3 w-3 text-slate-400" /> {identText(i)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-slate-400">None — add RINs, dockets, CFR parts or bills so matching alerts join automatically</span>
                    )}
                  </dd>
                  <dt className="text-slate-500">Description</dt>
                  <dd className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">{g.description || "—"}</dd>
                </dl>
              </Section>

              {g.total_count > 0 && (
                <Section title="Priority mix">
                  <BandBar byBand={g.by_band} total={g.total_count} className="h-2.5 w-full" />
                  <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                    {BAND_ORDER.filter((b) => g.by_band[b] > 0).map((b) => (
                      <li key={b} className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: BAND_COLORS[b] }} />
                        <span className="flex-1 text-slate-600 dark:text-slate-300">{BAND_LABELS[b]}</span>
                        <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{g.by_band[b]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">The group&apos;s priority and score are those of its highest version.</p>
                </Section>
              )}

              <Section
                title="Products"
                action={
                  canEdit && (
                    <Popover open={productsOpen} onOpenChange={setProductsOpen}>
                      <PopoverTrigger asChild>
                        <button className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10">
                          <Package className="h-3.5 w-3.5" /> Attach
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 p-1.5">
                        <ProductPicker
                          title={`Products for ${g.title}`}
                          attached={new Set(g.products.map((p) => p.key))}
                          inherited={inherited}
                          onToggle={async (ref, attach) => {
                            if (await setGroupProduct(g.id, ref, attach, g.title)) {
                              props.onChanged(attach ? `Attached “${ref.name}”` : `Removed “${ref.name}”`);
                            }
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  )
                }
              >
                {g.products.length ? (
                  <div className="flex flex-wrap gap-1.5">{g.products.map((p) => <ProductChip key={p.key} product={p} />)}</div>
                ) : (
                  <p className="text-sm text-slate-400">No products attached. Alerts in the group inherit any you add.</p>
                )}
              </Section>
            </>
          )}

          {tab === "versions" && (
            sections.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 py-12 text-center dark:border-slate-700">
                <Layers className="h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">No alerts in this group yet</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">Alerts join automatically when they share an identifier recorded on the group, or you can move them here from Alerts.</p>
              </div>
            ) : (
              sections.map(({ node, items }) => (
                <section key={node.id}>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    {node.id === g.id ? "In this group" : (
                      <button type="button" onClick={() => props.onOpenGroup(node.id, "versions")} className="hover:text-blue-600 hover:underline">
                        {node.path.slice(g.depth).join(" › ")}
                      </button>
                    )}
                    <span className="font-normal">· {items.length}</span>
                  </h3>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900/40">
                    {items.map((a) => <li key={a.id}><VersionRow a={a} onOpen={() => props.onOpenAlert(a.id)} /></li>)}
                  </ul>
                </section>
              ))
            )
          )}

          {tab === "subgroups" && (
            <>
              {children.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 py-12 text-center dark:border-slate-700">
                  <FolderTree className="h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">No sub-groups</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900/40">
                  {children.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => props.onOpenGroup(c.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{c.title}</span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {[c.level ? LEVEL_LABELS[c.level] : null, c.group_key, `${c.total_count} alert${c.total_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <PriorityBadge priority={c.highest_priority} />
                        <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{c.score ?? "—"}</span>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && g.depth < MAX_GROUP_DEPTH && (
                <button onClick={() => props.onAddSub(g)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600 dark:border-slate-600 dark:text-slate-300">
                  <Plus className="h-4 w-4" /> {g.level === "family" ? "Add action" : "Add sub-group"}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
