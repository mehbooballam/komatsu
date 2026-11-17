"use client";

import { useState, useCallback } from "react";

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
  high: "#c2410c",
  moderate: "#d97706",
  low: "#0d9488",
  unscored: "#d1d5db",
  none: "#e5e7eb",
};

// Simplified world map paths — major countries with ISO alpha-2 codes
const COUNTRY_PATHS: Record<string, string> = {
  US: "M 85,135 L 170,135 175,160 160,175 140,175 130,185 85,180 60,165 55,145 Z",
  CA: "M 60,80 L 185,80 190,120 170,130 85,130 55,135 40,110 Z",
  MX: "M 70,175 L 130,185 135,205 120,220 95,215 75,200 Z",
  BR: "M 210,230 L 260,210 280,230 275,280 250,300 220,290 200,260 Z",
  AR: "M 215,300 L 245,290 250,340 235,370 220,350 Z",
  GB: "M 345,105 L 355,100 358,115 350,120 Z",
  FR: "M 348,125 L 365,118 372,135 360,145 345,140 Z",
  DE: "M 365,108 L 380,105 385,125 370,130 362,118 Z",
  ES: "M 335,140 L 355,138 358,155 340,158 Z",
  IT: "M 370,135 L 380,130 385,155 375,165 370,150 Z",
  SE: "M 375,70 L 385,60 390,90 380,100 Z",
  NO: "M 365,55 L 375,50 380,80 370,85 Z",
  FI: "M 395,55 L 405,50 410,80 398,85 Z",
  PL: "M 385,105 L 400,102 405,120 390,122 Z",
  RU: "M 410,60 L 580,55 600,100 550,120 500,110 450,100 410,95 Z",
  CN: "M 530,130 L 590,120 600,155 570,170 540,165 520,150 Z",
  JP: "M 605,130 L 615,125 618,150 610,155 Z",
  KR: "M 595,135 L 603,130 605,145 598,148 Z",
  IN: "M 490,170 L 520,160 530,190 515,215 495,200 Z",
  AU: "M 555,275 L 615,265 625,300 600,315 560,310 Z",
  NZ: "M 635,315 L 645,310 648,330 638,335 Z",
  ZA: "M 385,290 L 410,280 415,305 395,315 Z",
  NG: "M 365,215 L 380,210 383,228 368,230 Z",
  EG: "M 395,170 L 415,165 418,185 400,188 Z",
  SA: "M 420,175 L 445,170 448,200 430,205 Z",
  AE: "M 450,185 L 460,183 462,195 452,196 Z",
  TR: "M 395,135 L 425,130 430,145 400,148 Z",
  ID: "M 540,220 L 585,215 590,235 545,238 Z",
  TH: "M 530,195 L 540,190 543,210 533,212 Z",
  VN: "M 545,185 L 555,180 558,205 548,207 Z",
  PH: "M 575,190 L 585,185 588,210 578,212 Z",
  MY: "M 540,210 L 555,208 557,220 542,222 Z",
  CL: "M 200,300 L 212,295 215,360 205,365 Z",
  CO: "M 185,210 L 205,205 210,230 195,235 Z",
  PE: "M 185,240 L 205,235 210,265 190,270 Z",
  AT: "M 372,118 L 385,116 387,125 374,126 Z",
  CH: "M 362,122 L 372,120 374,128 364,130 Z",
  NL: "M 358,105 L 366,103 367,112 359,113 Z",
  BE: "M 354,112 L 362,110 363,118 355,119 Z",
  IE: "M 335,100 L 345,98 346,112 337,113 Z",
  PT: "M 330,140 L 338,138 339,155 331,156 Z",
  DK: "M 370,95 L 378,93 379,103 371,104 Z",
  SG: "M 540,222 L 545,221 546,226 541,227 Z",
  IL: "M 410,160 L 416,158 417,170 411,171 Z",
};

export function WorldMap({ countries, unmappedCount, onCountryClick }: WorldMapProps) {
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: CountryData | null;
  }>({ visible: false, x: 0, y: 0, data: null });

  const countryDataMap = new Map<string, CountryData>();
  for (const c of countries) {
    const code = (c.iso_code || c.code || "").toUpperCase();
    countryDataMap.set(code, c);
  }

  const getCountryColor = useCallback(
    (code: string) => {
      const data = countryDataMap.get(code);
      if (!data) return PRIORITY_COLORS.none;
      return PRIORITY_COLORS[data.highest_priority] || PRIORITY_COLORS.none;
    },
    [countries]
  );

  const handleMouseEnter = (e: React.MouseEvent, code: string) => {
    const data = countryDataMap.get(code);
    if (data) {
      const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 10,
        data,
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltip({ visible: false, x: 0, y: 0, data: null });
  };

  return (
    <div className="relative w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Global Risk Heat Map
        </h3>
        {unmappedCount > 0 && (
          <button
            onClick={() => onCountryClick?.("unmapped")}
            className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
            {unmappedCount} Unmapped
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
        <svg
          viewBox="0 0 660 380"
          className="w-full h-auto"
          role="img"
          aria-label="World risk heat map showing alert priorities by country"
        >
          <rect width="660" height="380" fill="transparent" />

          {Object.entries(COUNTRY_PATHS).map(([code, path]) => (
            <path
              key={code}
              d={path}
              fill={getCountryColor(code)}
              stroke="#fff"
              strokeWidth="0.5"
              className="cursor-pointer transition-opacity hover:opacity-80"
              onMouseEnter={(e) => handleMouseEnter(e, code)}
              onMouseLeave={handleMouseLeave}
              onClick={() => {
                const data = countryDataMap.get(code);
                if (data) onCountryClick?.(code);
              }}
              role="button"
              aria-label={`${code}: ${countryDataMap.get(code)?.display_name || code}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const data = countryDataMap.get(code);
                  if (data) onCountryClick?.(code);
                }
              }}
            />
          ))}
        </svg>

        {tooltip.visible && tooltip.data && (
          <div
            className="absolute z-50 pointer-events-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{
              left: Math.min(tooltip.x, 500),
              top: Math.max(tooltip.y - 80, 10),
            }}
          >
            <div className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {tooltip.data.display_name}
            </div>
            <div className="text-gray-600 dark:text-gray-400 mb-1">
              {tooltip.data.alert_count} alert{tooltip.data.alert_count !== 1 ? "s" : ""}
            </div>
            <div className="space-y-0.5">
              {tooltip.data.by_band.critical > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS.critical }} />
                  <span>Critical: {tooltip.data.by_band.critical}</span>
                </div>
              )}
              {tooltip.data.by_band.high > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS.high }} />
                  <span>High: {tooltip.data.by_band.high}</span>
                </div>
              )}
              {tooltip.data.by_band.moderate > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS.moderate }} />
                  <span>Moderate: {tooltip.data.by_band.moderate}</span>
                </div>
              )}
              {tooltip.data.by_band.low > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS.low }} />
                  <span>Low: {tooltip.data.by_band.low}</span>
                </div>
              )}
              {tooltip.data.by_band.unscored > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS.unscored }} />
                  <span>Unscored: {tooltip.data.by_band.unscored}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-600 dark:text-gray-400">
        {(["critical", "high", "moderate", "low"] as const).map((band) => (
          <div key={band} className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: PRIORITY_COLORS[band] }}
            />
            <span className="capitalize">{band}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-sm border border-gray-300 dark:border-gray-600"
            style={{ backgroundColor: PRIORITY_COLORS.none }}
          />
          <span>No data</span>
        </div>
      </div>
    </div>
  );
}
