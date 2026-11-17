"use client";

import React from "react";
import { AlertTriangle, AlertOctagon, Info, CheckCircle2, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Priority = "critical" | "high" | "moderate" | "low" | "unscored";

interface PriorityBadgeProps {
  priority: Priority;
  label?: string;
  className?: string;
  showIcon?: boolean;
}

const priorityConfig: Record<Priority, { icon: React.ElementType; defaultLabel: string; variant: Priority }> = {
  critical: { icon: AlertOctagon, defaultLabel: "Critical", variant: "critical" },
  high: { icon: AlertTriangle, defaultLabel: "High", variant: "high" },
  moderate: { icon: Info, defaultLabel: "Moderate", variant: "moderate" },
  low: { icon: CheckCircle2, defaultLabel: "Low", variant: "low" },
  unscored: { icon: HelpCircle, defaultLabel: "Unscored", variant: "unscored" },
};

export function PriorityBadge({ priority, label, className, showIcon = true }: PriorityBadgeProps) {
  const config = priorityConfig[priority] || priorityConfig.unscored;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={cn("gap-1", className)}>
      {showIcon && <Icon className="h-3 w-3" aria-hidden="true" />}
      <span>{label || config.defaultLabel}</span>
    </Badge>
  );
}

export function priorityFromBand(band: string | null | undefined): Priority {
  if (!band) return "unscored";
  const normalized = band.toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "moderate") return "moderate";
  if (normalized === "low") return "low";
  return "unscored";
}
