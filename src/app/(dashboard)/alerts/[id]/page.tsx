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
    <div className="mx-auto max-w-4xl space-y-4">
      <Link
        href="/alerts"
        className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-white hover:text-[var(--foreground)] dark:hover:bg-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to alerts
      </Link>
      <AlertDrawer alertId={alertId} onClose={() => {}} inline />
    </div>
  );
}
