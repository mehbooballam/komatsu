"use client";

import React from "react";
import { useParams } from "next/navigation";
import { AlertDrawer } from "@/components/alerts/alert-drawer";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AlertDetailPage() {
  const params = useParams();
  const alertId = params.id as string;

  return (
    <div className="space-y-4">
      <Link
        href="/alerts"
        className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Alerts
      </Link>
      <div className="border rounded-lg bg-[var(--card)]">
        <AlertDrawer alertId={alertId} onClose={() => {}} />
      </div>
    </div>
  );
}
