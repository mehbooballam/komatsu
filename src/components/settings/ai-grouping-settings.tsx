"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, KeyRound, Cpu, Workflow, FileText, Loader2, Check, AlertTriangle, RotateCcw, Save, ExternalLink, ChevronDown, PlugZap, Eye, EyeOff } from "lucide-react";
import { CLAUDE_MODELS, PROVIDER_INFO, type Provider } from "@/lib/ai/provider-info";

interface Settings {
  enabled: boolean;
  provider: Provider;
  model: string | null;
  base_url: string | null;
  has_key: boolean;
  api_key_last4: string | null;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  grouping_prompt: string;
  prompt_is_default: boolean;
  read_source_pages: boolean;
  theme_fallback: boolean;
  after_import: "off" | "review" | "apply";
  auto_accept_confidence: number;
  min_confidence: number;
  updated_at: string | null;
  updated_by_name: string | null;
}

const EFFORTS = [
  { v: "medium", label: "Medium", hint: "Faster, lower cost" },
  { v: "high", label: "High (recommended)", hint: "Careful matching" },
  { v: "xhigh", label: "Extra high", hint: "Slower, for hard cases" },
  { v: "max", label: "Max", hint: "Slowest, highest cost" },
  { v: "low", label: "Low", hint: "Fastest" },
] as const;

const AFTER_IMPORT = [
  { v: "off", label: "Do nothing", hint: "Run AI grouping yourself from the Groups page" },
  { v: "review", label: "Prepare a proposal for review", hint: "Nothing changes until someone applies it" },
  { v: "apply", label: "Apply automatically", hint: "Low-confidence placements still wait in Needs review" },
] as const;

const field = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900";

function Card({ title, subtitle, icon: Icon, children, action }: { title: string; subtitle?: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
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

function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800 dark:text-slate-200">{children}</label>
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function AiGroupingSettings({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [outputRules, setOutputRules] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [replacingKey, setReplacingKey] = useState(false);
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label: string }> | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [test, setTest] = useState<{ busy?: boolean; ok?: boolean; text?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/ai")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setLoadError(j.error || "Could not load the AI settings");
          return;
        }
        setSaved(j.settings);
        setDraft(j.settings);
        setDefaultPrompt(j.default_prompt);
        setOutputRules(j.output_rules);
      })
      .catch(() => !cancelled && setLoadError("Could not load the AI settings"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const provider = draft ? PROVIDER_INFO[draft.provider] : null;
  const modelOptions = useMemo(() => {
    if (!draft) return [];
    const base = models ?? (draft.provider === "anthropic" ? CLAUDE_MODELS : []);
    const list = [...base];
    if (draft.model && !list.some((m) => m.id === draft.model)) list.unshift({ id: draft.model, label: draft.model });
    return list;
  }, [models, draft]);

  if (loadError) return <p className="panel p-6 text-sm text-red-600">{loadError}</p>;
  if (!draft || !saved || !provider) {
    return <div className="space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="panel h-40 animate-pulse" />)}</div>;
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const dirty =
    JSON.stringify({ ...draft, grouping_prompt: draft.grouping_prompt.trim() }) !== JSON.stringify({ ...saved, grouping_prompt: saved.grouping_prompt.trim() }) ||
    !!newKey.trim() || removeKey;
  const keyForRequests = newKey.trim() || undefined;
  const usingSavedKey = !newKey.trim() && saved.has_key && !removeKey && draft.provider === saved.provider;
  const promptIsDefault = draft.grouping_prompt.trim() === defaultPrompt.trim();

  async function loadModels() {
    if (!draft) return;
    setModelsBusy(true);
    try {
      const r = await fetch("/api/settings/ai/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: draft.provider, base_url: draft.base_url, api_key: keyForRequests }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not load the models");
      setModels(j.models);
      setFlash({ ok: true, text: `${j.models.length} models available to this key` });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Could not load the models" });
    } finally {
      setModelsBusy(false);
    }
  }

  async function runTest() {
    if (!draft) return;
    setTest({ busy: true });
    const r = await fetch("/api/settings/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: draft.provider, model: draft.model, base_url: draft.base_url, api_key: keyForRequests }),
    });
    const j = await r.json().catch(() => ({}));
    setTest(r.ok ? { ok: true, text: `Connected — ${j.model} answered in ${(j.latency_ms / 1000).toFixed(1)} s` } : { ok: false, text: j.error || "Connection failed" });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        enabled: draft.enabled,
        provider: draft.provider,
        model: draft.model,
        base_url: draft.base_url,
        effort: draft.effort,
        grouping_prompt: promptIsDefault ? null : draft.grouping_prompt,
        read_source_pages: draft.read_source_pages,
        theme_fallback: draft.theme_fallback,
        after_import: draft.after_import,
        auto_accept_confidence: draft.auto_accept_confidence,
        min_confidence: draft.min_confidence,
      };
      if (newKey.trim()) body.api_key = newKey.trim();
      else if (removeKey) body.api_key = null;
      const r = await fetch("/api/settings/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not save");
      setSaved(j.settings);
      setDraft(j.settings);
      setNewKey("");
      setReplacingKey(false);
      setRemoveKey(false);
      setFlash({ ok: true, text: "AI grouping settings saved" });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  const saveBar = (
    <div className="flex flex-wrap items-center gap-3">
      {flash && <span role="status" className={`text-sm ${flash.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{flash.text}</span>}
      {dirty && !flash && <span className="text-sm text-amber-700 dark:text-amber-300">Unsaved changes</span>}
      <button
        onClick={save}
        disabled={!canEdit || !dirty || saving}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card
        title="AI grouping"
        subtitle="Use a language model to review every alert and its source link, and group alerts by regulation"
        icon={Sparkles}
        action={saveBar}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            {draft.enabled ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" /> On — {provider.label}{draft.model ? ` · ${draft.model}` : ""}</span>
            ) : (
              <span>Off. The built-in rules (identifiers, CFR part, similar subject) still group alerts after each import.</span>
            )}
            {saved.updated_at && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Last changed {new Date(saved.updated_at).toLocaleString()}{saved.updated_by_name ? ` by ${saved.updated_by_name}` : ""}
              </p>
            )}
          </div>
          <label className="inline-flex items-center gap-3 text-sm font-medium">
            Use AI grouping
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              disabled={!canEdit}
              onClick={() => set("enabled", !draft.enabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${draft.enabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${draft.enabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </label>
        </div>
      </Card>

      {/* Connection */}
      <Card title="Provider and model" subtitle="Any provider: Claude, OpenAI, Google Gemini, or another OpenAI-compatible API" icon={Cpu}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Label htmlFor="ai-provider">Provider</Label>
            <select
              id="ai-provider"
              className={field}
              disabled={!canEdit}
              value={draft.provider}
              onChange={(e) => {
                const p = e.target.value as Provider;
                setModels(null);
                setTest(null);
                setDraft((d) => (d ? { ...d, provider: p, base_url: null, model: PROVIDER_INFO[p].defaultModel } : d));
              }}
            >
              {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>)}
            </select>
          </div>

          {draft.provider !== "anthropic" && (
            <div>
              <Label htmlFor="ai-base" hint={provider.needsBaseUrl ? "The provider's OpenAI-compatible endpoint, e.g. https://…/v1" : `Leave empty for ${provider.baseUrl}`}>
                API base URL{provider.needsBaseUrl ? "" : " (optional)"}
              </Label>
              <input
                id="ai-base"
                className={field}
                disabled={!canEdit}
                value={draft.base_url ?? ""}
                placeholder={provider.baseUrl ?? "https://api.example.com/v1"}
                onChange={(e) => set("base_url", e.target.value || null)}
              />
            </div>
          )}

          {/* API key */}
          <div className={draft.provider === "anthropic" ? "" : "lg:col-span-2"}>
            <Label
              htmlFor="ai-key"
              hint={
                <>
                  Stored encrypted; it is never shown again or sent to the browser.
                  {provider.keyUrl && (
                    <> <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline">Get a key <ExternalLink className="h-3 w-3" /></a></>
                  )}
                </>
              }
            >
              <span className="inline-flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> API key</span>
            </Label>
            {saved.has_key && !replacingKey && !removeKey && draft.provider === saved.provider ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-3 font-mono text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Saved key ••••{saved.api_key_last4}
                </span>
                {canEdit && (
                  <>
                    <button onClick={() => setReplacingKey(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Replace</button>
                    <button onClick={() => { setRemoveKey(true); set("enabled", false); }} className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">Remove</button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="ai-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${field} pr-10 font-mono`}
                    disabled={!canEdit}
                    value={newKey}
                    placeholder={provider.keyHint}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {(replacingKey || removeKey) && (
                  <button onClick={() => { setReplacingKey(false); setRemoveKey(false); setNewKey(""); }} className="rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                    Keep saved key
                  </button>
                )}
              </div>
            )}
            {removeKey && <p className="mt-1 text-xs text-red-600">The saved key will be removed when you save.</p>}
          </div>

          {/* Model */}
          <div className={draft.provider === "anthropic" ? "" : "lg:col-span-2"}>
            <Label htmlFor="ai-model" hint="Load the list to see every model your key can use.">Model</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              {customModel || (!modelOptions.length && draft.provider !== "anthropic") ? (
                <input id="ai-model" className={`${field} font-mono`} disabled={!canEdit} value={draft.model ?? ""} placeholder="model id" onChange={(e) => set("model", e.target.value || null)} />
              ) : (
                <select id="ai-model" className={field} disabled={!canEdit} value={draft.model ?? ""} onChange={(e) => set("model", e.target.value || null)}>
                  <option value="">Choose a model…</option>
                  {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label} — ${m.id}`}</option>)}
                </select>
              )}
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={loadModels}
                  disabled={modelsBusy || (!usingSavedKey && !newKey.trim())}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {modelsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />} Load models
                </button>
                <button type="button" onClick={() => setCustomModel((v) => !v)} className="h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                  {customModel ? "Pick from list" : "Type an id"}
                </button>
              </div>
            </div>
          </div>

          {draft.provider === "anthropic" && (
            <div>
              <Label htmlFor="ai-effort" hint="How hard Claude thinks about each batch. Higher is more careful, slower and costs more.">Effort</Label>
              <select id="ai-effort" className={field} disabled={!canEdit} value={draft.effort} onChange={(e) => set("effort", e.target.value as Settings["effort"])}>
                {EFFORTS.map((x) => <option key={x.v} value={x.v}>{x.label} — {x.hint}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={runTest}
            disabled={test?.busy || !draft.model || (!usingSavedKey && !newKey.trim())}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {test?.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
          </button>
          {test && !test.busy && (
            <span className={`inline-flex items-center gap-1.5 text-sm ${test.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>
              {test.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {test.text}
            </span>
          )}
        </div>
      </Card>

      {/* Behaviour */}
      <Card title="How results are used" subtitle="Nothing is moved that a person grouped by hand" icon={Workflow}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <Label>After each import</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {AFTER_IMPORT.map((o) => (
                <label
                  key={o.v}
                  className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors ${draft.after_import === o.v ? "border-blue-400 bg-blue-50 dark:border-blue-500/50 dark:bg-blue-500/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="after-import" className="accent-blue-600" disabled={!canEdit} checked={draft.after_import === o.v} onChange={() => set("after_import", o.v)} />
                    {o.label}
                  </span>
                  <span className="mt-1 pl-5 text-xs text-[var(--muted-foreground)]">{o.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="ai-accept" hint="At or above this, a placement counts as reviewed. Below it, the alert is grouped but waits in Needs review.">Auto-accept confidence</Label>
            <div className="flex items-center gap-2">
              <input id="ai-accept" type="number" min={0} max={100} className={`${field} w-28`} disabled={!canEdit} value={draft.auto_accept_confidence} onChange={(e) => set("auto_accept_confidence", Number(e.target.value))} />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          <div>
            <Label htmlFor="ai-min" hint="Below this, the alert is not placed at all and is listed as ungrouped with the reason.">Minimum confidence to place</Label>
            <div className="flex items-center gap-2">
              <input id="ai-min" type="number" min={0} max={100} className={`${field} w-28`} disabled={!canEdit} value={draft.min_confidence} onChange={(e) => set("min_confidence", Number(e.target.value))} />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
          <label className="flex items-start gap-3 text-sm lg:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" disabled={!canEdit} checked={draft.theme_fallback} onChange={(e) => set("theme_fallback", e.target.checked)} />
            <span>
              <span className="font-medium">Group what AI can&apos;t place by regulatory theme</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                An alert&apos;s theme is its first Daptic topic (e.g. &ldquo;Global Chemical Regulations&rdquo;, &ldquo;Battery Regulations&rdquo;). Alerts AI leaves ungrouped go into a &ldquo;Theme: …&rdquo; group with the Theme label, and are checked again by later runs.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm lg:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" disabled={!canEdit} checked={draft.read_source_pages} onChange={(e) => set("read_source_pages", e.target.checked)} />
            <span>
              <span className="font-medium">Read the source links</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                Before grouping, the app opens each alert&apos;s link and reads the page title and description (often the official regulation name). Only public pages are read; each is read at most once a month.
              </span>
            </span>
          </label>
        </div>
      </Card>

      {/* Prompt */}
      <Card
        title="Grouping instructions (prompt)"
        subtitle="What the model is told about matching alerts to one regulation. Grouping follows these instructions."
        icon={FileText}
        action={
          <button
            type="button"
            disabled={!canEdit || promptIsDefault}
            onClick={() => set("grouping_prompt", defaultPrompt)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" /> Reset to default
          </button>
        }
      >
        <textarea
          aria-label="Grouping prompt"
          className="min-h-[28rem] w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-[13px] leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
          disabled={!canEdit}
          value={draft.grouping_prompt}
          onChange={(e) => set("grouping_prompt", e.target.value)}
          spellCheck={false}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
          <span>{promptIsDefault ? "Default instructions" : "Custom instructions"} · {draft.grouping_prompt.length.toLocaleString()} characters</span>
          <button type="button" onClick={() => setShowRules((v) => !v)} className="font-medium text-blue-600 hover:underline">
            {showRules ? "Hide" : "Show"} what the app adds to every request
          </button>
        </div>
        {showRules && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">
              Added after your instructions so the answer can be read by the app (not editable). Each request also contains the existing groups and the alerts as JSON.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[12px] text-slate-700 dark:text-slate-300">{outputRules}</pre>
          </div>
        )}
      </Card>

      <div className="flex justify-end">{saveBar}</div>
    </div>
  );
}
