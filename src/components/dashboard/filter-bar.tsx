"use client";

import React, { useState, useCallback } from "react";
import { X, Filter, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface FilterState {
  countries: string[];
  sources: string[];
  stages: string[];
  products: string[];
  tags: string[];
  groups: string[];
  priorities: string[];
  deadlineWindow: string | null;
  owners: string[];
  reviewStatus: string[];
  missingData: string[];
  search: string;
}

export const emptyFilters: FilterState = {
  countries: [],
  sources: [],
  stages: [],
  products: [],
  tags: [],
  groups: [],
  priorities: [],
  deadlineWindow: null,
  owners: [],
  reviewStatus: [],
  missingData: [],
  search: "",
};

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface FilterGroupProps {
  label: string;
  filterKey: keyof FilterState;
  options: FilterOption[];
  selected: string[];
  onChange: (key: keyof FilterState, values: string[]) => void;
}

function FilterGroup({ label, filterKey, options, selected, onChange }: FilterGroupProps) {
  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(filterKey, next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-8 gap-1", selected.length > 0 && "border-[var(--primary)] text-[var(--primary)]")}>
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full px-1.5 text-xs">
              {selected.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-[var(--accent)]">
              <Checkbox checked={selected.includes(opt.value)} onCheckedChange={() => toggle(opt.value)} />
              <span className="flex-1 truncate">{opt.label}</span>
              {opt.count !== undefined && <span className="text-xs text-[var(--muted-foreground)]">{opt.count}</span>}
            </label>
          ))}
          {options.length === 0 && <p className="px-2 py-3 text-sm text-[var(--muted-foreground)]">No options</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FilterBarProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  filterOptions?: {
    countries?: FilterOption[];
    sources?: FilterOption[];
    stages?: FilterOption[];
    products?: FilterOption[];
    tags?: FilterOption[];
    groups?: FilterOption[];
    priorities?: FilterOption[];
    owners?: FilterOption[];
    reviewStatus?: FilterOption[];
    missingData?: FilterOption[];
  };
  matchCount?: number;
  className?: string;
}

const defaultPriorityOptions: FilterOption[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "moderate", label: "Moderate" },
  { value: "low", label: "Low" },
  { value: "unscored", label: "Unscored" },
];

const defaultStageOptions: FilterOption[] = [
  { value: "signal", label: "Signal / Information" },
  { value: "draft", label: "Draft" },
  { value: "consultation", label: "Consultation Open" },
  { value: "final_mandatory", label: "Final (Mandatory)" },
  { value: "final_voluntary", label: "Final (Voluntary)" },
  { value: "unknown", label: "Unknown" },
];

const deadlineOptions: FilterOption[] = [
  { value: "overdue", label: "Overdue" },
  { value: "30", label: "Within 30 days" },
  { value: "90", label: "Within 90 days" },
  { value: "180", label: "Within 6 months" },
  { value: "365", label: "Within 1 year" },
  { value: "none", label: "No deadline" },
];

export function FilterBar({ filters, onFiltersChange, filterOptions = {}, matchCount, className }: FilterBarProps) {
  const [showSearch, setShowSearch] = useState(!!filters.search);

  const handleChange = useCallback((key: keyof FilterState, values: string[] | string | null) => {
    onFiltersChange({ ...filters, [key]: values });
  }, [filters, onFiltersChange]);

  const activeFilterCount = [
    ...filters.countries, ...filters.sources, ...filters.stages,
    ...filters.products, ...filters.tags, ...filters.groups,
    ...filters.priorities, ...filters.owners, ...filters.reviewStatus,
    ...filters.missingData,
  ].length + (filters.deadlineWindow ? 1 : 0) + (filters.search ? 1 : 0);

  const hasFilters = activeFilterCount > 0;

  const activeChips: Array<{ key: keyof FilterState; value: string; label: string }> = [];
  const addChips = (key: keyof FilterState, values: string[]) => values.forEach((v) => activeChips.push({ key, value: v, label: v }));

  addChips("countries", filters.countries);
  addChips("priorities", filters.priorities);
  addChips("stages", filters.stages);
  addChips("products", filters.products);
  addChips("tags", filters.tags);
  addChips("groups", filters.groups);
  addChips("owners", filters.owners);
  if (filters.deadlineWindow) activeChips.push({ key: "deadlineWindow", value: filters.deadlineWindow, label: `Deadline: ${deadlineOptions.find((o) => o.value === filters.deadlineWindow)?.label || filters.deadlineWindow}` });

  const removeChip = (key: keyof FilterState, value: string) => {
    const current = filters[key];
    if (Array.isArray(current)) {
      handleChange(key, current.filter((v) => v !== value));
    } else {
      handleChange(key, null);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-sm text-[var(--muted-foreground)]">
          <Filter className="h-3.5 w-3.5" />
          <span>Filters</span>
        </div>

        <FilterGroup label="Priority" filterKey="priorities" options={filterOptions.priorities || defaultPriorityOptions} selected={filters.priorities} onChange={(k, v) => handleChange(k, v)} />
        <FilterGroup label="Country" filterKey="countries" options={filterOptions.countries || []} selected={filters.countries} onChange={(k, v) => handleChange(k, v)} />
        <FilterGroup label="Stage" filterKey="stages" options={filterOptions.stages || defaultStageOptions} selected={filters.stages} onChange={(k, v) => handleChange(k, v)} />
        <FilterGroup label="Product" filterKey="products" options={filterOptions.products || []} selected={filters.products} onChange={(k, v) => handleChange(k, v)} />
        <FilterGroup label="Group" filterKey="groups" options={filterOptions.groups || []} selected={filters.groups} onChange={(k, v) => handleChange(k, v)} />
        <FilterGroup label="Owner" filterKey="owners" options={filterOptions.owners || []} selected={filters.owners} onChange={(k, v) => handleChange(k, v)} />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-8 gap-1", filters.deadlineWindow && "border-[var(--primary)] text-[var(--primary)]")}>
              Deadline
              <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2" align="start">
            <div className="space-y-1">
              {deadlineOptions.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-[var(--accent)]">
                  <Checkbox checked={filters.deadlineWindow === opt.value} onCheckedChange={() => handleChange("deadlineWindow", filters.deadlineWindow === opt.value ? null : opt.value)} />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {!showSearch && (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowSearch(true)}>
            Search...
          </Button>
        )}

        {showSearch && (
          <Input
            placeholder="Search alerts..."
            value={filters.search}
            onChange={(e) => handleChange("search" as keyof FilterState, e.target.value as unknown as string[])}
            className="h-8 w-48 text-sm"
          />
        )}

        {matchCount !== undefined && (
          <span className="ml-auto text-sm text-[var(--muted-foreground)]">{matchCount} alerts</span>
        )}

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-[var(--muted-foreground)]" onClick={() => onFiltersChange(emptyFilters)}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear all
          </Button>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip, i) => (
            <Badge key={`${chip.key}-${chip.value}-${i}`} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5">
              <span className="text-xs">{chip.label}</span>
              <button
                onClick={() => removeChip(chip.key, chip.value)}
                className="rounded-full p-0.5 hover:bg-[var(--muted)]"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
