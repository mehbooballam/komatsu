"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  emptyPriority, emptyRisk, emptyScorecard, LEVEL_LABELS, MAX_ROWS, RAG_LABELS, STATUS_LABELS, TREND_LABELS,
  type Rag, type ReportContent, type SectionKey,
} from "@/lib/reports";

/** When set, only that section's fields are shown (inline editing from the report view). */
const OnlySection = React.createContext<SectionKey | null>(null);

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white";
const labelCls = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";
const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-slate-800 dark:hover:text-slate-200";

type Setter = (next: ReportContent) => void;

function Section({ k, n, title, hint, children }: { k: SectionKey; n?: string; title: string; hint?: string; children: React.ReactNode }) {
  const only = React.useContext(OnlySection);
  if (only) return only === k ? <div className="space-y-4">{hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}{children}</div> : null;
  return (
    <section className="panel p-4 sm:p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {n && <span className="mr-1.5 text-slate-400">{n}</span>}{title}
        </h2>
        {hint && <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{hint}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function Text({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      className={`${inputCls} resize-y leading-relaxed`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Line({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Choice<T extends string>({ value, options, onChange, empty = "—" }: {
  value: T; options: Record<string, string>; onChange: (v: T) => void; empty?: string;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      <option value="">{empty}</option>
      {Object.entries(options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

/** Move / remove buttons for a row in a repeating list. */
function RowTools({ index, count, onMove, onRemove, label }: {
  index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <button type="button" className={iconBtn} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${label} up`} title="Move up">
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={iconBtn} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${label} down`} title="Move down">
        <ArrowDown className="h-4 w-4" />
      </button>
      <button type="button" className={`${iconBtn} hover:!text-red-600`} onClick={onRemove} aria-label={`Remove ${label}`} title="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function AddButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:text-blue-300"
    >
      <Plus className="h-4 w-4" /> {children}
    </button>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A simple list of one-line bullet points. */
function BulletList({ items, onChange, placeholder, addLabel }: {
  items: string[]; onChange: (items: string[]) => void; placeholder: string; addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
          <textarea
            className={`${inputCls} min-h-[40px] resize-y`}
            rows={1}
            value={t}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <RowTools
            index={i}
            count={items.length}
            label="item"
            onMove={(to) => onChange(move(items, i, to))}
            onRemove={() => onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <AddButton onClick={() => onChange([...items, ""])} disabled={items.length >= MAX_ROWS}>{addLabel}</AddButton>
    </div>
  );
}

const RAG_CHOICES: Array<{ key: Rag; cls: string; ring: string }> = [
  { key: "green", cls: "bg-emerald-600 text-white", ring: "ring-emerald-600" },
  { key: "amber", cls: "bg-amber-400 text-slate-900", ring: "ring-amber-400" },
  { key: "red", cls: "bg-red-600 text-white", ring: "ring-red-600" },
];

export function ReportEditor({ content: c, onChange, section = null }: { content: ReportContent; onChange: Setter; section?: SectionKey | null }) {
  const set = <K extends keyof ReportContent>(key: K, value: ReportContent[K]) => onChange({ ...c, [key]: value });

  return (
    <OnlySection.Provider value={section}>
    <div className={section ? "" : "space-y-5"}>
      <Section k="cover" title="Cover" hint="Overall position and who the report is for.">
        <div>
          <span className={labelCls}>Overall rating</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Overall rating">
            {RAG_CHOICES.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={c.rag === r.key}
                onClick={() => set("rag", r.key)}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold ${r.cls} ${c.rag === r.key ? `ring-2 ring-offset-2 ${r.ring} dark:ring-offset-slate-900` : "opacity-40 hover:opacity-80"}`}
              >
                {RAG_LABELS[r.key]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Posture (left of the banner)">
            <Line value={c.posture} onChange={(v) => set("posture", v)} placeholder="e.g. Elevated, with active mitigation" />
          </Field>
          <Field label="Call-out (next to the rating)">
            <Line value={c.posture_callout} onChange={(v) => set("posture_callout", v)} placeholder="e.g. Leadership support needed" />
          </Field>
        </div>
        <Field label="Purpose of the report">
          <Text value={c.purpose} onChange={(v) => set("purpose", v)} />
        </Field>
        <Field label="Risk ranking — overall positioning">
          <Text
            value={c.ranking}
            onChange={(v) => set("ranking", v)}
            placeholder="e.g. The program is progressing and no immediate market-access interruption is identified…"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prepared for">
            <Line value={c.prepared_for} onChange={(v) => set("prepared_for", v)} />
          </Field>
          <Field label="Prepared by">
            <Line value={c.prepared_by} onChange={(v) => set("prepared_by", v)} />
          </Field>
        </div>
      </Section>

      <Section k="summary" n="1." title="Executive summary">
        <Field label="Leadership assessment">
          <Text value={c.leadership_assessment} onChange={(v) => set("leadership_assessment", v)} rows={4} />
        </Field>
        <Field label="Business implications">
          <Text value={c.business_implications} onChange={(v) => set("business_implications", v)} rows={3} />
        </Field>
      </Section>

      <Section k="priorities" title="Top leadership priorities" hint="One row per risk area. Rows marked out of scope are highlighted in the report.">
        {c.priorities.map((p, i) => {
          const update = (patch: Partial<typeof p>) => set("priorities", c.priorities.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">#{i + 1}</span>
                <input
                  className={`${inputCls} font-medium`}
                  value={p.area}
                  placeholder="Risk area — e.g. EU Cybersecurity / CRA"
                  aria-label="Risk area"
                  onChange={(e) => update({ area: e.target.value })}
                />
                <RowTools
                  index={i}
                  count={c.priorities.length}
                  label="priority"
                  onMove={(to) => set("priorities", move(c.priorities, i, to))}
                  onRemove={() => set("priorities", c.priorities.filter((_, j) => j !== i))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Level"><Choice value={p.level} options={LEVEL_LABELS} onChange={(v) => update({ level: v })} /></Field>
                <Field label="Trend"><Choice value={p.trend} options={TREND_LABELS} onChange={(v) => update({ trend: v })} /></Field>
                <Field label="Business exposure" className="lg:col-span-2">
                  <Line value={p.exposure} onChange={(v) => update({ exposure: v })} placeholder="e.g. Reporting failure; EU market access" />
                </Field>
                <Field label="This month's focus" className="sm:col-span-2 lg:col-span-3">
                  <Line value={p.focus} onChange={(v) => update({ focus: v })} placeholder="e.g. Finalize accountable reporting and backup coverage" />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={p.out_of_scope} onChange={(e) => update({ out_of_scope: e.target.checked })} />
                  Out of scope for team
                </label>
              </div>
            </div>
          );
        })}
        <AddButton onClick={() => set("priorities", [...c.priorities, emptyPriority()])} disabled={c.priorities.length >= MAX_ROWS}>
          Add risk area
        </AddButton>
      </Section>

      <Section k="decisions" title="Decisions and sponsorship requested" hint="Shown in red in the report.">
        <BulletList
          items={c.decisions}
          onChange={(v) => set("decisions", v)}
          placeholder="e.g. Confirm the permanent accountable owner…"
          addLabel="Add decision"
        />
      </Section>

      <Section k="risks" n="2." title="Material risk detail" hint="Numbered automatically in this order.">
        {c.risks.map((r, i) => {
          const update = (patch: Partial<typeof r>) => set("risks", c.risks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{i + 1}</span>
                <input
                  className={`${inputCls} font-medium`}
                  value={r.title}
                  placeholder="Risk title — e.g. Cyber Resilience Act incident reporting"
                  aria-label="Risk title"
                  onChange={(e) => update({ title: e.target.value })}
                />
                <div className="w-36 shrink-0">
                  <Choice value={r.level} options={LEVEL_LABELS} onChange={(v) => update({ level: v })} empty="Level" />
                </div>
                <RowTools
                  index={i}
                  count={c.risks.length}
                  label="risk"
                  onMove={(to) => set("risks", move(c.risks, i, to))}
                  onRemove={() => set("risks", c.risks.filter((_, j) => j !== i))}
                />
              </div>
              <div className="space-y-3">
                <Field label="Current evidence"><Text value={r.evidence} onChange={(v) => update({ evidence: v })} /></Field>
                <Field label="Next actions"><Text value={r.next_actions} onChange={(v) => update({ next_actions: v })} rows={2} /></Field>
                <Field label="Leadership role"><Text value={r.leadership_role} onChange={(v) => update({ leadership_role: v })} rows={2} /></Field>
              </div>
            </div>
          );
        })}
        <AddButton onClick={() => set("risks", [...c.risks, emptyRisk()])} disabled={c.risks.length >= MAX_ROWS}>Add risk</AddButton>
      </Section>

      <Section k="scorecard" title="Leadership scorecard">
        {c.scorecard.map((s, i) => {
          const update = (patch: Partial<typeof s>) => set("scorecard", c.scorecard.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="grid items-end gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[2fr_1fr_1.3fr_1.3fr_auto] dark:border-slate-700">
              <Field label="Indicator"><Line value={s.indicator} onChange={(v) => update({ indicator: v })} /></Field>
              <Field label="Status"><Choice value={s.status} options={STATUS_LABELS} onChange={(v) => update({ status: v })} /></Field>
              <Field label="Desired state"><Line value={s.desired} onChange={(v) => update({ desired: v })} /></Field>
              <Field label="Interpretation"><Line value={s.interpretation} onChange={(v) => update({ interpretation: v })} /></Field>
              <RowTools
                index={i}
                count={c.scorecard.length}
                label="indicator"
                onMove={(to) => set("scorecard", move(c.scorecard, i, to))}
                onRemove={() => set("scorecard", c.scorecard.filter((_, j) => j !== i))}
              />
            </div>
          );
        })}
        <AddButton onClick={() => set("scorecard", [...c.scorecard, emptyScorecard()])} disabled={c.scorecard.length >= MAX_ROWS}>
          Add indicator
        </AddButton>
        <Field label="Note under the scorecard (optional)">
          <Text value={c.scorecard_note} onChange={(v) => set("scorecard_note", v)} rows={2} />
        </Field>
      </Section>

      <Section k="next_30_days" title="Next 30 days">
        <BulletList
          items={c.next_30_days}
          onChange={(v) => set("next_30_days", v)}
          placeholder="e.g. Close CRA registration…"
          addLabel="Add action"
        />
      </Section>
    </div>
    </OnlySection.Provider>
  );
}
