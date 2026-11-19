"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { askChangeComment } from "@/components/layout/change-comment";

interface MappingOptions {
  /** Continents (level "region") first, then countries */
  countries: Array<{ code: string; display_name: string; level?: string }>;
  manual_codes: string[];
  automatic_codes: string[];
}

interface AlertCountryMappingProps {
  alertId: string;
  alertTitle: string;
  jurisdiction?: string | null;
  editing?: boolean;
  /** Small text-style trigger (used under already-mapped locations) */
  compact?: boolean;
  onSaved: (message: string) => void;
}

export function AlertCountryMapping({ alertId, alertTitle, jurisdiction, editing, compact, onSaved }: AlertCountryMappingProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {compact ? (
            <button
              type="button"
              aria-label={`Edit locations for ${alertTitle}`}
              title="Edit location"
              className="inline-flex items-center rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-700 dark:hover:bg-slate-800 dark:hover:text-blue-300"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <Button type="button" variant="outline" size="sm">
              <MapPin aria-hidden="true" />
              {editing ? "Edit location" : "Map to location"}
            </Button>
          )}
        </PopoverTrigger>
        {open && (
          <CountryMappingForm
            key={alertId}
            alertId={alertId}
            alertTitle={alertTitle}
            jurisdiction={jurisdiction}
            onClose={() => setOpen(false)}
            onSaved={(message) => {
              setOpen(false);
              onSaved(message);
            }}
          />
        )}
      </Popover>
    </span>
  );
}

function CountryMappingForm({ alertId, alertTitle, jurisdiction, onClose, onSaved }: AlertCountryMappingProps & { onClose: () => void }) {
  const [options, setOptions] = useState<MappingOptions | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const endpoint = `/api/alerts/${alertId}/geographies`;

  useEffect(() => {
    const controller = new AbortController();
    async function loadCountries() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load countries.");
        const result: MappingOptions = await response.json();
        if (controller.signal.aborted) return;
        setOptions(result);
        setSelected(new Set(result.manual_codes));
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load countries.");
        setNeedsReload(true);
      }
    }
    void loadCountries();
    return () => controller.abort();
  }, [endpoint, loadKey]);

  const searchTerm = search.trim().toLowerCase();
  const matches = options?.countries.filter((country) =>
    country.display_name.toLowerCase().includes(searchTerm) || country.code.toLowerCase() === searchTerm
  ) ?? [];
  const continentMatches = matches.filter((m) => m.level === "region");
  const countryMatches = matches.filter((m) => m.level !== "region");
  const automaticallyMapped = new Set(options?.automatic_codes);
  const hasChanges = options !== null && (
    selected.size !== options.manual_codes.length || options.manual_codes.some((code) => !selected.has(code))
  );

  function renderOption({ code, display_name, level }: { code: string; display_name: string; level?: string }) {
    const automatic = automaticallyMapped.has(code);
    return (
      <label key={code} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--accent)]">
        <input type="checkbox" checked={automatic || selected.has(code)} disabled={automatic} onChange={(event) => changeSelection(code, event.target.checked)} />
        <span className={`flex-1 ${level === "region" ? "font-medium" : ""}`}>{display_name}</span>
        <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{automatic ? "Already mapped" : level === "region" ? "Continent" : code}</span>
      </label>
    );
  }

  function changeSelection(code: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options || !hasChanges || saving || needsReload) return;
    const comment = await askChangeComment({
      action: selected.size ? `Set countries to ${[...selected].sort().join(", ")}` : "Clear the country mapping",
    });
    if (!comment) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country_codes: [...selected], expected_country_codes: options.manual_codes, comment }),
      });
      if (!response.ok) {
        if (response.status === 409) setNeedsReload(true);
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Could not save the country mapping.");
      }
      onSaved(selected.size ? "Location mapping saved" : "Manual location mapping removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the country mapping.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PopoverContent
      align="start"
      sideOffset={6}
      collisionPadding={12}
      aria-label={`Map countries for ${alertTitle}`}
      className="z-[60] max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw_-_1.5rem)] overflow-y-auto rounded-xl p-3"
    >
      <form onSubmit={save} className="min-w-0 space-y-2">
        {jurisdiction && <p className="break-words text-xs text-[var(--muted-foreground)]">Imported jurisdiction: {jurisdiction}</p>}
        <Input
          type="search"
          aria-label="Search continents or countries"
          placeholder="Search continents or countries"
          className="h-8 text-xs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
        />
        {!options && !error && <p role="status" className="text-sm text-[var(--muted-foreground)]">Loading countries…</p>}
        {options && (
          <>
            <p aria-live="polite" className="text-xs text-[var(--muted-foreground)]">{selected.size} selected</p>
            <fieldset disabled={saving || needsReload} className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] p-1">
              <legend className="sr-only">Continents and countries</legend>
              {matches.length === 0 && <p className="px-2 py-3 text-sm text-[var(--muted-foreground)]">Nothing found.</p>}
              {continentMatches.length > 0 && (
                <>
                  <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Continents</p>
                  {continentMatches.map(renderOption)}
                  {countryMatches.length > 0 && <div role="separator" className="mx-1 my-1.5 border-t border-[var(--border)]" />}
                </>
              )}
              {countryMatches.length > 0 && continentMatches.length > 0 && (
                <p className="px-2 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Countries</p>
              )}
              {countryMatches.map(renderOption)}
            </fieldset>
          </>
        )}
        {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          {needsReload ? (
            <Button type="button" size="sm" onClick={() => {
              setOptions(null);
              setError(null);
              setNeedsReload(false);
              setLoadKey((value) => value + 1);
            }}>Reload countries</Button>
          ) : (
            <Button type="submit" size="sm" disabled={!hasChanges || saving}>{saving ? "Saving…" : "Save mapping"}</Button>
          )}
        </div>
      </form>
    </PopoverContent>
  );
}
