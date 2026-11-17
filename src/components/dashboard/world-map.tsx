"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import { Globe2, Minus, Plus, RotateCcw } from "lucide-react";
import { numericToAlpha2 } from "@/lib/geo/countries";

interface CountryData {
  code: string;
  iso_code: string;
  display_name: string;
  alert_count: number;
  highest_priority: string;
  by_band: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    unscored: number;
  };
}

interface WorldMapProps {
  countries: CountryData[];
  unmappedCount: number;
  onCountryClick?: (code: string) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "#7c3aed",
  high: "#dc4a0c",
  moderate: "#f59e0b",
  low: "#14b8a6",
  unscored: "#94a3b8",
};

const BANDS = ["critical", "high", "moderate", "low", "unscored"] as const;

const WIDTH = 960;
const HEIGHT = 500;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

type CountryFeature = Feature<Geometry, { name?: string }> & { alpha2?: string };

// Loaded once per page session and shared between renders.
let worldCache: Promise<CountryFeature[]> | null = null;
function loadWorld(): Promise<CountryFeature[]> {
  if (!worldCache) {
    worldCache = import("world-atlas/countries-50m.json").then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
      const fc = feature(topo, topo.objects.countries);
      return fc.features
        .filter((f) => f.properties?.name !== "Antarctica")
        .map((f) => ({ ...f, alpha2: numericToAlpha2(f.id as string | undefined) })) as CountryFeature[];
    });
  }
  return worldCache;
}

export function WorldMap({ countries, unmappedCount, onCountryClick }: WorldMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [features, setFeatures] = useState<CountryFeature[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; code: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWorld()
      .then((f) => !cancelled && setFeatures(f))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const dataByCode = useMemo(() => {
    const m = new Map<string, CountryData>();
    for (const c of countries) m.set((c.iso_code || c.code || "").toUpperCase(), c);
    return m;
  }, [countries]);

  const paths = useMemo(() => {
    if (!features) return [];
    const projection = geoNaturalEarth1().fitExtent(
      [
        [8, 8],
        [WIDTH - 8, HEIGHT - 8],
      ],
      { type: "FeatureCollection", features } as GeoPermissibleObjects
    );
    const path = geoPath(projection);
    return features.map((f, i) => ({
      key: `${f.id ?? "x"}-${i}`,
      d: path(f) || "",
      code: f.alpha2,
      name: f.properties?.name || "Unknown",
    }));
  }, [features]);

  // Pan + zoom (wheel, pinch, drag, double-click)
  useEffect(() => {
    if (!svgRef.current || !features) return;
    const svg = select(svgRef.current);
    const behavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on("zoom", (event) => setTransform(event.transform));
    svg.call(behavior);
    zoomRef.current = behavior;
    return () => {
      svg.on(".zoom", null);
    };
  }, [features]);

  const zoomBy = (factor: number) => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, factor);
    }
  };
  const resetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, zoomIdentity);
    }
  };

  const fillFor = (code?: string) => {
    const data = code ? dataByCode.get(code) : undefined;
    return data ? PRIORITY_COLORS[data.highest_priority] || PRIORITY_COLORS.unscored : undefined;
  };

  const handleMove = (e: React.MouseEvent, code: string | undefined, name: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, code: code || "", name });
  };

  const hoverData = hover?.code ? dataByCode.get(hover.code) : undefined;

  return (
    <div className="relative w-full">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
            <Globe2 className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Global risk heat map</h2>
            <p className="text-xs text-[var(--muted-foreground)]">
              {countries.length} {countries.length === 1 ? "country" : "countries"} with alerts · click a country to filter
            </p>
          </div>
        </div>
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
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-sky-50 to-blue-50/60 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900"
      >
        {!features && !loadError && (
          <div className="flex items-center justify-center aspect-[960/500] text-xs text-gray-400">Loading map…</div>
        )}
        {loadError && (
          <div className="flex items-center justify-center aspect-[960/500] text-xs text-red-500">
            Could not load map data.
          </div>
        )}

        {features && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block w-full h-auto cursor-grab active:cursor-grabbing touch-none select-none"
            role="img"
            aria-label="World risk heat map showing alert priorities by country. Scroll or pinch to zoom, drag to pan."
            onMouseLeave={() => setHover(null)}
          >
            <g transform={transform.toString()}>
              {paths.map((p) => {
                const fill = fillFor(p.code);
                const hasData = !!fill;
                return (
                  <path
                    key={p.key}
                    d={p.d}
                    fill={fill}
                    className={`${hasData ? "cursor-pointer hover:brightness-110" : "fill-gray-200 dark:fill-slate-700"} stroke-white dark:stroke-slate-900 transition-[filter]`}
                    strokeWidth={0.6 / transform.k}
                    onMouseMove={(e) => handleMove(e, p.code, p.name)}
                    onClick={() => hasData && p.code && onCountryClick?.(p.code)}
                    role={hasData ? "button" : undefined}
                    tabIndex={hasData ? 0 : undefined}
                    aria-label={hasData ? `${p.name}: ${dataByCode.get(p.code!)?.alert_count} alerts` : undefined}
                    onKeyDown={(e) => {
                      if (hasData && p.code && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onCountryClick?.(p.code);
                      }
                    }}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {/* Zoom controls */}
        {features && (
          <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 shadow-sm">
            <button
              type="button"
              onClick={() => zoomBy(1.6)}
              disabled={transform.k >= MAX_ZOOM}
              className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => zoomBy(1 / 1.6)}
              disabled={transform.k <= MIN_ZOOM}
              className="p-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              disabled={transform.k === 1 && transform.x === 0 && transform.y === 0}
              className="p-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
              aria-label="Reset view"
              title="Reset view"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        )}

        {features && (
          <div className="absolute left-2 bottom-2 rounded bg-white/80 dark:bg-gray-800/80 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 pointer-events-none">
            {Math.round(transform.k * 100)}% · scroll to zoom, drag to pan
          </div>
        )}

        {hover && (
          <div
            className="absolute z-50 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{
              left: Math.max(4, Math.min(hover.x + 12, hover.w - 170)),
              top: Math.max(hover.y - 12, 4),
              transform: hover.y > 140 ? "translateY(-100%)" : undefined,
            }}
          >
            <div className="font-semibold text-gray-900 dark:text-gray-100">{hoverData?.display_name || hover.name}</div>
            {hoverData ? (
              <>
                <div className="text-gray-600 dark:text-gray-400 mb-1">
                  {hoverData.alert_count} alert{hoverData.alert_count !== 1 ? "s" : ""}
                </div>
                <div className="space-y-0.5">
                  {BANDS.filter((b) => hoverData.by_band[b] > 0).map((b) => (
                    <div key={b} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[b] }} />
                      <span className="capitalize">
                        {b}: {hoverData.by_band[b]}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-gray-500 dark:text-gray-400">No alerts</div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-600 dark:text-gray-400">
        {BANDS.map((band) => (
          <div key={band} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: PRIORITY_COLORS[band] }}
            />
            <span className="capitalize">{band}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-slate-700" />
          <span>No data</span>
        </div>
      </div>
    </div>
  );
}
