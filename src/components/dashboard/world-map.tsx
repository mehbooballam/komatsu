"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import { ArrowUpRight, Globe2, Minus, Plus, RotateCcw } from "lucide-react";

/**
 * Global risk map — same logic as the regulation risk scorer's map:
 * - countries, and US / Canadian / Australian states and provinces as their own shapes;
 * - a national rule paints every shape of its country; a state rule paints that state only;
 *   a shape takes the higher band of the two;
 * - a ring marks states/provinces that have rules of their own;
 * - a jurisdiction list (highest band first) frames the map on a jurisdiction when clicked;
 *   jurisdictions without a place on the map (feeds, "Global") are listed without a colour.
 */

type Band = "critical" | "high" | "moderate" | "low" | "unscored";
type ByBand = Record<Band, number>;

interface CountryData {
  code: string;
  iso_code: string;
  display_name: string;
  alert_count: number;
  highest_priority: string;
  max_score?: number;
  by_band: ByBand;
}

export interface SubdivisionData {
  country: string;
  name: string;
  label: string;
  alert_count: number;
  highest_priority: string;
  max_score: number;
  by_band: ByBand;
}

export interface JurisdictionData {
  label: string;
  kind: "country" | "sub" | "off";
  codes: string[];
  sub: { country: string; name: string } | null;
  alert_count: number;
  highest_priority: string;
  max_score: number;
}

interface WorldMapProps {
  countries: CountryData[];
  subdivisions?: SubdivisionData[];
  jurisdictions?: JurisdictionData[];
  unmappedCount: number;
  /** Country (alpha-2) clicked on the map, or "unmapped" */
  onCountryClick?: (code: string) => void;
  /** A jurisdiction label to open in Alerts (states, and rows of the list) */
  onJurisdictionClick?: (label: string) => void;
  /** Extra control shown at the right of the header (e.g. a full-screen button). */
  headerAction?: React.ReactNode;
  /** Fill the parent's height without the built-in header (full-screen view). */
  fill?: boolean;
}

interface Shape {
  /** Country alpha-2, or e.g. "US-CA" for a state */
  k: string;
  /** Country alpha-2 */
  c: string;
  /** State code when this is a state/province */
  s: string;
  n: string;
  /** Bounds [x, y, w, h] in viewBox units */
  b: [number, number, number, number];
  d: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#7c3aed",
  high: "#dc4a0c",
  moderate: "#f59e0b",
  low: "#14b8a6",
  unscored: "#94a3b8",
};
const BANDS: Band[] = ["critical", "high", "moderate", "low", "unscored"];
const rank = (b: string) => (BANDS.indexOf(b as Band) === -1 ? 99 : BANDS.indexOf(b as Band));

const MIN_ZOOM = 1;
const MAX_ZOOM = 14;

let mapCache: Promise<{ viewBox: number[]; shapes: Shape[] }> | null = null;
function loadMap() {
  if (!mapCache) {
    mapCache = fetch("/maps/world-subdivisions.json")
      .then((r) => {
        if (!r.ok) throw new Error("map");
        return r.json();
      })
      .then((j: { viewBox: string; shapes: Shape[] }) => ({ viewBox: j.viewBox.split(" ").map(Number), shapes: j.shapes }));
  }
  return mapCache;
}

const subKey = (country: string, name: string) => `${country}|${name.toLowerCase()}`;

export function WorldMap({ countries, subdivisions = [], jurisdictions = [], unmappedCount, onCountryClick, onJurisdictionClick, headerAction, fill = false }: WorldMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [map, setMap] = useState<{ viewBox: number[]; shapes: Shape[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; shape: Shape } | null>(null);
  // Jurisdiction framed from the list (its shapes stay lit, the rest fade)
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMap()
      .then((m) => !cancelled && setMap(m))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const byCountry = useMemo(() => new Map(countries.map((c) => [(c.iso_code || c.code).toUpperCase(), c])), [countries]);
  const bySub = useMemo(() => new Map(subdivisions.map((s) => [subKey(s.country, s.name), s])), [subdivisions]);

  // What each shape shows: national data, state data, and the higher band of the two
  const shapeInfo = useMemo(() => {
    const out = new Map<string, { nat?: CountryData; loc?: SubdivisionData; band: string | null; count: number }>();
    for (const sh of map?.shapes ?? []) {
      const nat = byCountry.get(sh.c);
      const loc = sh.s ? bySub.get(subKey(sh.c, sh.n)) : undefined;
      const bands = [nat?.highest_priority, loc?.highest_priority].filter(Boolean) as string[];
      const band = bands.length ? bands.sort((a, b) => rank(a) - rank(b))[0] : null;
      out.set(sh.k, { nat, loc, band, count: (nat?.alert_count ?? 0) + (loc?.alert_count ?? 0) });
    }
    return out;
  }, [map, byCountry, bySub]);

  // Shapes of a jurisdiction from the list
  const shapesFor = (j: JurisdictionData | undefined): Shape[] => {
    if (!j || !map) return [];
    if (j.kind === "sub" && j.sub) return map.shapes.filter((s) => s.s && s.c === j.sub!.country && s.n.toLowerCase() === j.sub!.name.toLowerCase());
    if (j.kind === "country") return map.shapes.filter((s) => j.codes.includes(s.c));
    return [];
  };
  const focusJ = jurisdictions.find((j) => j.label === focus);
  const focusKeys = useMemo(() => new Set(shapesFor(focusJ).map((s) => s.k)), [focusJ, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan + zoom (wheel, pinch, drag, double-click), in viewBox units
  useEffect(() => {
    if (!svgRef.current || !map) return;
    const [x0, y0, w, h] = map.viewBox;
    const svg = select(svgRef.current);
    const behavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .extent([[x0, y0], [x0 + w, y0 + h]])
      .translateExtent([[x0 - w * 0.25, y0 - h * 0.25], [x0 + w * 1.25, y0 + h * 1.25]])
      .on("zoom", (event) => setTransform(event.transform));
    svg.call(behavior);
    zoomRef.current = behavior;
    return () => {
      svg.on(".zoom", null);
    };
  }, [map]);

  const animateTo = (t: ZoomTransform, ms = 450) => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(ms).call(zoomRef.current.transform, t);
  };
  const zoomBy = (factor: number) => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor);
  };
  const resetZoom = () => {
    setFocus(null);
    animateTo(zoomIdentity, 300);
  };

  // Frame a jurisdiction (union of its shapes' bounds), or the whole world
  const frame = (shapes: Shape[]) => {
    if (!map) return;
    if (!shapes.length) return animateTo(zoomIdentity);
    const [vx, vy, vw, vh] = map.viewBox;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of shapes) {
      x0 = Math.min(x0, s.b[0]);
      y0 = Math.min(y0, s.b[1]);
      x1 = Math.max(x1, s.b[0] + s.b[2]);
      y1 = Math.max(y1, s.b[1] + s.b[3]);
    }
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const k = Math.max(1, Math.min(12, Math.min(vw / (bw * 1.8), vh / (bh * 1.8))));
    const cx = x0 + bw / 2, cy = y0 + bh / 2;
    animateTo(zoomIdentity.translate(vx + vw / 2 - k * cx, vy + vh / 2 - k * cy).scale(k));
  };

  const pickJurisdiction = (j: JurisdictionData) => {
    if (focus === j.label) {
      setFocus(null);
      animateTo(zoomIdentity);
      return;
    }
    setFocus(j.label);
    frame(shapesFor(j));
  };

  const clickShape = (sh: Shape) => {
    const info = shapeInfo.get(sh.k);
    if (!info?.band) return;
    // A state with its own rules opens those; otherwise the country's alerts
    if (info.loc) onJurisdictionClick?.(info.loc.label);
    else onCountryClick?.(sh.c);
  };

  const handleMove = (e: React.MouseEvent, shape: Shape) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, shape });
  };

  const hoverInfo = hover ? shapeInfo.get(hover.shape.k) : undefined;
  const stroke = 0.35 / transform.k;
  const offMap = jurisdictions.filter((j) => j.kind === "off").length;

  return (
    <div className={fill ? "relative flex h-full w-full flex-col" : "relative w-full"}>
      {!fill && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <Globe2 className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Global risk heat map</h2>
              <p className="text-xs text-[var(--muted-foreground)]">
                Shaded by the highest priority in force there · {jurisdictions.length} jurisdiction{jurisdictions.length === 1 ? "" : "s"}
                {offMap ? ` · ${offMap} off-map` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {unmappedCount > 0 && (
              <button
                onClick={() => onCountryClick?.("unmapped")}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title="Alerts whose jurisdiction isn't a country"
              >
                <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
                {unmappedCount} unmapped
              </button>
            )}
            {headerAction}
          </div>
        </div>
      )}

      <div className={`flex min-h-0 flex-col gap-3 ${fill ? "flex-1 lg:flex-row" : "xl:flex-row"}`}>
        {/* Map */}
        <div
          ref={containerRef}
          className={`relative min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-sky-50 to-blue-50/60 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900 ${fill ? "min-h-0 flex-1" : "xl:flex-1"}`}
        >
          {!map && !loadError && <div className="flex aspect-[539/233] items-center justify-center text-xs text-gray-400">Loading map…</div>}
          {loadError && <div className="flex aspect-[539/233] items-center justify-center text-xs text-red-500">Could not load map data.</div>}

          {map && (
            <svg
              ref={svgRef}
              viewBox={map.viewBox.join(" ")}
              preserveAspectRatio="xMidYMid meet"
              className={`block w-full ${fill ? "h-full" : "h-auto"} cursor-grab touch-none select-none active:cursor-grabbing`}
              role="img"
              aria-label="World risk map by jurisdiction. States and provinces with their own rules are ringed. Scroll or pinch to zoom, drag to pan."
              onMouseLeave={() => setHover(null)}
            >
              <g transform={transform.toString()}>
                {map.shapes.map((sh) => {
                  const info = shapeInfo.get(sh.k)!;
                  const hasData = !!info.band;
                  const dim = focusKeys.size > 0 && !focusKeys.has(sh.k);
                  return (
                    <path
                      key={sh.k}
                      d={sh.d}
                      fill={hasData ? PRIORITY_COLORS[info.band!] : undefined}
                      fillOpacity={dim ? 0.25 : 1}
                      className={`${hasData ? "cursor-pointer hover:brightness-110" : "fill-gray-200 dark:fill-slate-700"} stroke-white transition-[filter,fill-opacity] dark:stroke-slate-900`}
                      strokeWidth={sh.s ? stroke * 0.8 : stroke}
                      onMouseMove={(e) => handleMove(e, sh)}
                      onClick={() => clickShape(sh)}
                      role={hasData ? "button" : undefined}
                      tabIndex={hasData ? 0 : undefined}
                      aria-label={hasData ? `${sh.n}: ${info.count} alerts, highest ${info.band}` : undefined}
                      onKeyDown={(e) => {
                        if (hasData && (e.key === "Enter" || e.key === " ")) {
                          e.preventDefault();
                          clickShape(sh);
                        }
                      }}
                    />
                  );
                })}
                {/* Ring on states/provinces that have rules of their own */}
                {map.shapes.map((sh) =>
                  shapeInfo.get(sh.k)?.loc ? (
                    <circle
                      key={`dot-${sh.k}`}
                      cx={sh.b[0] + sh.b[2] / 2}
                      cy={sh.b[1] + sh.b[3] / 2}
                      r={2.6 / Math.sqrt(transform.k)}
                      className="pointer-events-none fill-white stroke-slate-900 dark:stroke-white dark:fill-slate-900"
                      strokeWidth={0.9 / Math.sqrt(transform.k)}
                      opacity={focusKeys.size > 0 && !focusKeys.has(sh.k) ? 0.3 : 1}
                    />
                  ) : null
                )}
              </g>
            </svg>
          )}

          {map && (
            <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white/90 shadow-sm dark:border-gray-700 dark:bg-gray-800/90">
              <button type="button" onClick={() => zoomBy(1.6)} disabled={transform.k >= MAX_ZOOM} className="p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Zoom in" title="Zoom in">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => zoomBy(1 / 1.6)} disabled={transform.k <= MIN_ZOOM} className="border-t border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Zoom out" title="Zoom out">
                <Minus className="h-4 w-4" />
              </button>
              <button type="button" onClick={resetZoom} disabled={transform.k === 1 && transform.x === 0 && transform.y === 0 && !focus} className="border-t border-gray-200 p-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700" aria-label="Show the whole world" title="Show the whole world">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          )}

          {map && (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800/80 dark:text-gray-400">
              {Math.round(transform.k * 100)}% · scroll to zoom, drag to pan
            </div>
          )}

          {hover && (
            <div
              className="pointer-events-none absolute z-50 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
              style={{ left: Math.max(4, Math.min(hover.x + 12, hover.w - 200)), top: Math.max(hover.y - 12, 4), transform: hover.y > 140 ? "translateY(-100%)" : undefined }}
            >
              <div className="font-semibold text-gray-900 dark:text-gray-100">{hover.shape.n}</div>
              {hoverInfo?.band ? (
                <div className="mt-1 space-y-1">
                  {hoverInfo.loc && (
                    <div>
                      <span className="text-gray-500">Own rules:</span> {hoverInfo.loc.alert_count} alert{hoverInfo.loc.alert_count === 1 ? "" : "s"} ·{" "}
                      <span className="capitalize">{hoverInfo.loc.highest_priority}</span>
                    </div>
                  )}
                  {hoverInfo.nat && (
                    <div>
                      <span className="text-gray-500">{hover.shape.s ? "National rules:" : "Alerts:"}</span> {hoverInfo.nat.alert_count} ·{" "}
                      <span className="capitalize">{hoverInfo.nat.highest_priority}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-2 pt-0.5">
                    {BANDS.map((b) => {
                      const n = (hoverInfo.nat?.by_band[b] ?? 0) + (hoverInfo.loc?.by_band[b] ?? 0);
                      return n ? (
                        <span key={b} className="inline-flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[b] }} />
                          <span className="capitalize">{b}</span> {n}
                        </span>
                      ) : null;
                    })}
                  </div>
                  <div className="text-[11px] text-blue-600 dark:text-blue-400">Click to see these alerts</div>
                </div>
              ) : (
                <div className="text-gray-500 dark:text-gray-400">No alerts</div>
              )}
            </div>
          )}
        </div>

        {/* Jurisdictions (highest band first) */}
        {jurisdictions.length > 0 && (
          <div className={`flex min-h-0 flex-col rounded-xl border border-slate-200 dark:border-slate-700 ${fill ? "lg:w-72" : "xl:w-64"}`}>
            <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">Jurisdictions</p>
            <ul className={`min-h-0 flex-1 overflow-y-auto ${fill ? "" : "max-h-64 xl:max-h-[19rem]"}`}>
              {jurisdictions.map((j) => {
                const on = focus === j.label;
                return (
                  <li key={j.label} className={`group flex items-center gap-2 px-3 py-1.5 text-sm ${on ? "bg-blue-50 dark:bg-blue-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                    <button
                      type="button"
                      onClick={() => (j.kind === "off" ? onJurisdictionClick?.(j.label) : pickJurisdiction(j))}
                      aria-pressed={on}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      title={j.kind === "off" ? `${j.label} — not shown on the map` : on ? "Show the whole world" : `Show ${j.label} on the map`}
                    >
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-sm ${j.kind === "off" ? "border border-dashed border-slate-400" : ""}`}
                        style={j.kind === "off" ? undefined : { backgroundColor: PRIORITY_COLORS[j.highest_priority] ?? PRIORITY_COLORS.unscored }}
                      />
                      <span className={`min-w-0 flex-1 truncate ${j.kind === "off" ? "text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>{j.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500" title={`Highest score ${j.max_score} across ${j.alert_count} alert${j.alert_count === 1 ? "" : "s"}`}>
                        <strong className="font-semibold text-slate-800 dark:text-slate-200">{j.max_score || "—"}</strong> · {j.alert_count}
                      </span>
                    </button>
                    {j.kind !== "off" && (
                      <button
                        type="button"
                        onClick={() => onJurisdictionClick?.(j.label)}
                        aria-label={`Open the alerts for ${j.label}`}
                        title="Open these alerts"
                        className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:text-blue-600 group-hover:opacity-100 focus:opacity-100"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-800">
              Highest score · alerts. Rows without a colour have no place on the map (feeds, standards bodies, global).
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
        {BANDS.map((band) => (
          <div key={band} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm border border-gray-300 dark:border-gray-600" style={{ backgroundColor: PRIORITY_COLORS[band] }} />
            <span className="capitalize">{band}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-gray-300 bg-gray-200 dark:border-gray-600 dark:bg-slate-700" />
          <span>No alerts</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
            <circle cx="6.5" cy="6.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span>Has its own state or provincial rules</span>
        </div>
      </div>
    </div>
  );
}
