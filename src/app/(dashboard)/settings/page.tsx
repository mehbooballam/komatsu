"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Save, SlidersHorizontal, Building2, Upload, ImageIcon, RotateCcw, Calculator, History, ShieldAlert, Check, Loader2, Info, Lock,
} from "lucide-react";
import { useSessionInfo, useRefreshSession } from "@/components/layout/session-context";
import { ImageUpload } from "@/components/ui/image-upload";
import { ConfirmDialog } from "@/components/alerts/confirm-dialog";
import {
  BANDS, FACTOR_KEYS, FACTOR_LABELS, MAX_TOTAL, RATING_VALUES,
  bandForTotal, escalationText, factorEscalations, maxBand, validatePolicy,
  type Band, type EscalationRule, type FactorKey, type ScoringPolicy,
} from "@/lib/scoring/policy";

const BAND_STYLE: Record<Band, { label: string; color: string; chip: string }> = {
  low: { label: "Low", color: "#14b8a6", chip: "bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30" },
  moderate: { label: "Moderate", color: "#f59e0b", chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30" },
  high: { label: "High", color: "#dc4a0c", chip: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30" },
  critical: { label: "Critical", color: "#7c3aed", chip: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30" },
};

const TIME_ZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore",
  "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney",
];

const RULE_TITLES: Record<EscalationRule["condition"], string> = {
  market_access_9: "High market access sets a minimum priority",
  urgency_9_and_market_access_gte_6: "Urgent and significant market access",
  forecast_missed_deadline: "Missed or overdue compliance deadline",
};

interface PolicyResponse {
  policy: ScoringPolicy;
  version: number;
  published_at: string | null;
  published_by: string | null;
  can_edit: boolean;
  history: Array<{ id: string; version: number; published_at: string; is_active: boolean; published_by: string | null }>;
  defaults: ScoringPolicy;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function Section({ title, subtitle, icon: Icon, children, action }: { title: string; subtitle?: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function RatingSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
      {RATING_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(v)}
          className={`h-7 w-8 rounded-md text-xs font-semibold transition-colors ${
            value === v ? "bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function BandSelect({ value, onChange, disabled }: { value: Band; onChange: (b: Band) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {BANDS.map((b) => (
        <button
          key={b}
          type="button"
          disabled={disabled}
          onClick={() => onChange(b)}
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-all ${
            value === b ? BAND_STYLE[b].chip : "text-slate-500 ring-slate-200 hover:ring-slate-300 dark:ring-slate-700"
          }`}
        >
          {BAND_STYLE[b].label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Scoring tab ---------------- */

function ScoringPolicyEditor() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [draft, setDraft] = useState<ScoringPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [calc, setCalc] = useState<Record<FactorKey, number>>({ market_access: 6, cost_to_implement: 1, urgency: 9 });

  const load = useCallback(async () => {
    const res = await fetch("/api/scoring/policy");
    if (!res.ok) {
      setError("Could not load the scoring policy");
      return;
    }
    const d: PolicyResponse = await res.json();
    setData(d);
    setDraft(clone(d.policy));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scoring/policy")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError("Could not load the scoring policy");
          return;
        }
        const d: PolicyResponse = await res.json();
        if (cancelled) return;
        setData(d);
        setDraft(clone(d.policy));
      })
      .catch(() => !cancelled && setError("Could not load the scoring policy"));
    return () => {
      cancelled = true;
    };
  }, []);

  const readOnly = !data?.can_edit;
  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.policy) !== JSON.stringify(draft), [data, draft]);
  const problems = useMemo(() => (draft ? validatePolicy(draft) : []), [draft]);

  if (!data || !draft) {
    return (
      <div className="flex h-64 items-center justify-center">
        {error ? <p className="text-sm text-red-600">{error}</p> : <Loader2 className="h-8 w-8 animate-spin text-slate-300" />}
      </div>
    );
  }

  const set = (fn: (p: ScoringPolicy) => void) =>
    setDraft((prev) => {
      const next = clone(prev!);
      fn(next);
      return next;
    });

  // Bands: users edit the upper limit of Low/Moderate/High; the rest follows.
  const setUpper = (band: "low" | "moderate" | "high", raw: string) =>
    set((p) => {
      const v = Math.max(1, Math.min(MAX_TOTAL - 1, Math.round(Number(raw) || 0)));
      p.bands[band][1] = v;
      const order: Band[] = ["low", "moderate", "high", "critical"];
      const i = order.indexOf(band);
      p.bands[order[i + 1]][0] = v + 1;
    });

  // Calculator
  const total = calc.market_access * calc.cost_to_implement * calc.urgency;
  const base = bandForTotal(total, draft);
  const escalations = factorEscalations({ market_access: calc.market_access, urgency: calc.urgency }, draft);
  const finalBand = escalations.reduce<Band | null>((b, e) => maxBand(b, e.resulting_band), base) || base;

  const publish = async () => {
    setError(null);
    const res = await fetch("/api/scoring/policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy: draft, reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not save");
    setSaved(`Published version ${body.version} · ${body.recalculated} alerts re-scored`);
    setReason("");
    await load();
  };

  // Band bar widths: proportional on a log scale so Low is visible
  const logW = (b: Band) => {
    const [a, z] = draft.bands[b];
    return Math.max(4, Math.log(z + 1) - Math.log(a));
  };
  const totalW = BANDS.reduce((s, b) => s + logW(b), 0);

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">Version {data.version}</span>
          <span className="text-[var(--muted-foreground)]">
            {data.published_at ? `Published ${new Date(data.published_at).toLocaleString()}` : "Not published"}
            {data.published_by ? ` by ${data.published_by}` : ""}
          </span>
          {readOnly && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" /> Only administrators can edit</span>
          )}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {saved && !dirty && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check className="h-4 w-4" /> {saved}</span>}
            <button
              onClick={() => setDraft(clone(data.defaults))}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </button>
            {dirty && (
              <button onClick={() => setDraft(clone(data.policy))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                Discard changes
              </button>
            )}
            <button
              disabled={!dirty || problems.length > 0}
              onClick={() => setConfirmOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
            >
              <Save className="h-4 w-4" /> Save & re-score
            </button>
          </div>
        )}
      </div>

      {problems.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-semibold">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* Bands */}
          <Section title="Risk bands" subtitle="Total score = Market access × Cost to implement × Urgency (1 – 729). Set where each priority starts." icon={SlidersHorizontal}>
            <div className="mb-5 flex h-3 overflow-hidden rounded-full">
              {BANDS.map((b) => (
                <div key={b} style={{ width: `${(logW(b) / totalW) * 100}%`, backgroundColor: BAND_STYLE[b].color }} title={`${BAND_STYLE[b].label}: ${draft.bands[b][0]}–${draft.bands[b][1]}`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {BANDS.map((b) => {
                const [lo, hi] = draft.bands[b];
                const editableUpper = b !== "critical";
                return (
                  <div key={b} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BAND_STYLE[b].color }} />
                      <span className="text-sm font-semibold">{BAND_STYLE[b].label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="w-14 rounded-md bg-slate-100 px-2 py-1.5 text-center tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{lo.toLocaleString()}</span>
                      <span className="text-slate-400">–</span>
                      {editableUpper ? (
                        <input
                          type="number"
                          min={lo}
                          max={MAX_TOTAL - 1}
                          value={hi}
                          disabled={readOnly}
                          onChange={(e) => setUpper(b as "low" | "moderate" | "high", e.target.value)}
                          className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-center tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900"
                          aria-label={`${BAND_STYLE[b].label} upper limit`}
                        />
                      ) : (
                        <span className="w-20 rounded-md bg-slate-100 px-2 py-1.5 text-center tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{hi.toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Escalations */}
          <Section title="Escalation rules" subtitle="Raise an alert's priority regardless of its total score" icon={ShieldAlert}>
            <div className="space-y-3">
              {draft.escalations.map((rule, i) => (
                <div key={rule.condition} className={`rounded-xl border p-4 transition-opacity ${rule.enabled ? "border-slate-200 dark:border-slate-700" : "border-dashed border-slate-200 opacity-60 dark:border-slate-700"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{RULE_TITLES[rule.condition]}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{escalationText(rule)}</p>
                    </div>
                    <Toggle checked={rule.enabled} disabled={readOnly} label={`Enable ${RULE_TITLES[rule.condition]}`} onChange={(v) => set((p) => { p.escalations[i].enabled = v; })} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                    {rule.condition === "market_access_9" && (
                      <label className="flex items-center gap-2">
                        <span className="text-slate-600 dark:text-slate-400">When market access ≥</span>
                        <RatingSelect value={rule.params?.market_access ?? 9} disabled={readOnly || !rule.enabled} onChange={(v) => set((p) => { p.escalations[i].params = { ...p.escalations[i].params, market_access: v }; })} />
                      </label>
                    )}
                    {rule.condition === "urgency_9_and_market_access_gte_6" && (
                      <>
                        <label className="flex items-center gap-2">
                          <span className="text-slate-600 dark:text-slate-400">Urgency ≥</span>
                          <RatingSelect value={rule.params?.urgency ?? 9} disabled={readOnly || !rule.enabled} onChange={(v) => set((p) => { p.escalations[i].params = { ...p.escalations[i].params, urgency: v }; })} />
                        </label>
                        <label className="flex items-center gap-2">
                          <span className="text-slate-600 dark:text-slate-400">and market access ≥</span>
                          <RatingSelect value={rule.params?.market_access ?? 6} disabled={readOnly || !rule.enabled} onChange={(v) => set((p) => { p.escalations[i].params = { ...p.escalations[i].params, market_access: v }; })} />
                        </label>
                      </>
                    )}
                    <label className="flex items-center gap-2">
                      <span className="text-slate-600 dark:text-slate-400">{rule.condition === "market_access_9" ? "Minimum priority" : "Priority becomes"}</span>
                      <BandSelect value={rule.band} disabled={readOnly || !rule.enabled} onChange={(b) => set((p) => { p.escalations[i].band = b; })} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Factor descriptions */}
          <Section title="Factor ratings" subtitle="What each rating means. Shown to reviewers when they score an alert." icon={Info}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Factor</th>
                    {RATING_VALUES.map((v) => (
                      <th key={v} className="pb-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Rating {v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FACTOR_KEYS.map((key) => (
                    <tr key={key}>
                      <td className="border-t border-slate-100 py-2 pr-3 align-top font-medium dark:border-slate-800">{FACTOR_LABELS[key]}</td>
                      {RATING_VALUES.map((v) => (
                        <td key={v} className="border-t border-slate-100 py-2 pr-2 align-top dark:border-slate-800">
                          <textarea
                            rows={3}
                            value={draft.factors[key].boundaries[String(v)] || ""}
                            disabled={readOnly}
                            onChange={(e) => set((p) => { p.factors[key].boundaries[String(v)] = e.target.value; })}
                            className="w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs leading-snug focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">
              Urgency (C) is calculated from the confirmed compliance deadline when there is one; otherwise the imported rating is used.
            </p>
          </Section>
        </div>

        <div className="space-y-6">
          {/* Total score override */}
          <Section title="Total score override" subtitle="Let reviewers set an alert's total score directly" icon={SlidersHorizontal}>
            <div className="flex items-start justify-between gap-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                When on, the <strong>Adjust score</strong> panel lets reviewers replace the calculated Market access × Cost to implement × Urgency total with their own number (1 – 729), with a reason. The priority band follows the new total; escalation rules still apply.
              </p>
              <Toggle checked={draft.total_override_enabled} disabled={readOnly} label="Allow total score override" onChange={(v) => set((p) => { p.total_override_enabled = v; })} />
            </div>
          </Section>

          {/* Calculator */}
          <Section title="Try it" subtitle="Preview a score with your unsaved changes" icon={Calculator}>
            <div className="space-y-3">
              {FACTOR_KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-300">{FACTOR_LABELS[k]}</span>
                  <RatingSelect value={calc[k]} onChange={(v) => setCalc((c) => ({ ...c, [k]: v }))} />
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Total</p>
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{total.toLocaleString()}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${BAND_STYLE[finalBand].chip}`}>{BAND_STYLE[finalBand].label}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Band from total: <strong>{BAND_STYLE[base].label}</strong>
                {escalations.length > 0 && <> · escalated by: {escalations.map((e) => e.description).join("; ")}</>}
              </p>
            </div>
          </Section>

          {/* History */}
          <Section title="Version history" icon={History}>
            <ol className="space-y-2">
              {data.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${h.is_active ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>v{h.version}</span>
                    <span className="text-slate-700 dark:text-slate-300">{h.published_by || "System"}</span>
                  </span>
                  <span className="text-xs text-slate-400">{h.published_at ? new Date(h.published_at).toLocaleDateString() : "—"}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        danger={false}
        title="Publish scoring policy?"
        description="This saves a new policy version and re-scores every alert in this workspace. Priorities on the dashboard and alerts list will update."
        confirmLabel="Publish & re-score"
        onClose={() => setConfirmOpen(false)}
        onConfirm={publish}
      >
        <label className="mt-3 block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Reason for change (optional)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Raised High threshold after Q4 review"
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-950"
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}

/* ---------------- General tab ---------------- */

function GeneralSettings() {
  const session = useSessionInfo();
  const isAdmin = session?.membership.role === "company_admin";
  const [form, setForm] = useState<{ name: string; time_zone: string; slug: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => setForm({ name: d.company?.name || "", time_zone: d.company?.time_zone || "UTC", slug: d.company?.slug || "" }));
  }, []);

  if (!form) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/workspaces/current", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, time_zone: form.time_zone }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: body.error || "Could not save" });
    if (res.ok) setTimeout(() => window.location.reload(), 600);
  };

  const zones = TIME_ZONES.includes(form.time_zone) ? TIME_ZONES : [form.time_zone, ...TIME_ZONES];

  return (
    <div className="space-y-6">
    <Section title="Workspace" subtitle="Name and time zone used for scores and deadlines" icon={Building2}>
      <div className="grid max-w-2xl gap-4">
        <label className="block text-sm">
          <span className="font-medium">Workspace name</span>
          <input
            value={form.name}
            disabled={!isAdmin}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Workspace ID</span>
          <input value={form.slug} disabled className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Time zone</span>
          <select
            value={form.time_zone}
            disabled={!isAdmin}
            onChange={(e) => setForm({ ...form, time_zone: e.target.value })}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
          >
            {zones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <span className="mt-1 block text-xs text-[var(--muted-foreground)]">“Days left” and urgency are calculated from today in this time zone.</span>
        </label>
        {isAdmin && (
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
            {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
          </div>
        )}
      </div>
    </Section>
    <BrandingSettings />
    </div>
  );
}

function BrandingSettings() {
  const session = useSessionInfo();
  const refreshSession = useRefreshSession();
  const isAdmin = session?.membership.role === "company_admin";
  const branding = session?.company.settings || {};

  const save = (kind: "logo" | "logo_dark" | "icon") => async (image: string | null) => {
    const res = await fetch("/api/workspaces/current/logo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, image }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save");
    await refreshSession();
  };

  return (
    <Section title="Branding" subtitle="Logo and icon shown in the sidebar and workspace switcher" icon={ImageIcon}>
      {!isAdmin && <p className="mb-4 text-sm text-[var(--muted-foreground)]">Only administrators can change branding.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <ImageUpload
          label="Logo — light background"
          hint="Wide logo (e.g. wordmark). Shown in light mode. PNG, JPG, WebP or SVG."
          shape="wide"
          mode="fit"
          previewBg="#ffffff"
          value={branding.logo as string | undefined}
          disabled={!isAdmin}
          onSave={save("logo")}
        />
        <ImageUpload
          label="Logo — dark background"
          hint="Light-coloured version for dark mode. Optional — the light logo is used if empty."
          shape="wide"
          mode="fit"
          previewBg="#0a1630"
          value={branding.logo_dark as string | undefined}
          disabled={!isAdmin}
          onSave={save("logo_dark")}
        />
        <ImageUpload
          label="Icon"
          hint="Square mark used where space is tight and in the workspace switcher."
          shape="rounded"
          mode="square"
          previewBg="#ffffff"
          value={branding.icon as string | undefined}
          disabled={!isAdmin}
          onSave={save("icon")}
        />
      </div>
    </Section>
  );
}

/* ---------------- Page ---------------- */

const TABS = [
  { key: "scoring", label: "Scoring policy", icon: SlidersHorizontal },
  { key: "general", label: "Workspace", icon: Building2 },
  { key: "imports", label: "Imports", icon: Upload },
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("scoring");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">Scoring rules, workspace details and import defaults</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60 sm:w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "scoring" && <ScoringPolicyEditor />}
      {tab === "general" && <GeneralSettings />}
      {tab === "imports" && (
        <Section title="Imports" subtitle="How alert files are read" icon={Upload}>
          <dl className="grid max-w-2xl gap-4 text-sm">
            <div>
              <dt className="font-medium">Feed</dt>
              <dd className="text-[var(--muted-foreground)]">Daptic Alert Feed</dd>
            </div>
            <div>
              <dt className="font-medium">Update mode</dt>
              <dd className="text-[var(--muted-foreground)]">
                <strong>Preserve</strong>: blank cells in a re-import keep the previous value. Local edits (owners, groups, score adjustments) are always kept.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Formats</dt>
              <dd className="text-[var(--muted-foreground)]">Excel (.xlsx) and CSV with the 27-column Daptic layout — download a template on the Imports page.</dd>
            </div>
          </dl>
        </Section>
      )}
    </div>
  );
}
