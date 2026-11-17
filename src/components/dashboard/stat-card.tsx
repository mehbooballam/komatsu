"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  description?: string;
  icon?: React.ReactNode;
  trend?: { value: number; label: string };
  color?: string;
  onClick?: () => void;
  className?: string;
}

export function StatCard({ label, value, description, icon, trend, color, onClick, className }: StatCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Card className={cn("transition-shadow", onClick && "cursor-pointer hover:shadow-md", className)}>
      <Wrapper onClick={onClick} className="w-full text-left">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--muted-foreground)]">{label}</p>
              <p className={cn("text-2xl font-bold", color)} style={color?.startsWith("#") ? { color } : undefined}>
                {value}
              </p>
            </div>
            {icon && (
              <div className="rounded-lg p-2 bg-[var(--muted)]">{icon}</div>
            )}
          </div>
          {(description || trend) && (
            <div className="mt-2 flex items-center gap-2">
              {trend && (
                <span className={cn("text-xs font-medium", trend.value >= 0 ? "text-[var(--priority-low)]" : "text-[var(--destructive)]")}>
                  {trend.value >= 0 ? "+" : ""}{trend.value}%
                </span>
              )}
              {description && <span className="text-xs text-[var(--muted-foreground)]">{description}</span>}
              {trend && <span className="text-xs text-[var(--muted-foreground)]">{trend.label}</span>}
            </div>
          )}
        </CardContent>
      </Wrapper>
    </Card>
  );
}
