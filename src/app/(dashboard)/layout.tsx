"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/layout/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionContext, SessionRefreshContext, type SessionInfo } from "@/components/layout/session-context";

/** Placeholder shown in the sidebar slot while the session loads. */
function SidebarSkeleton() {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:w-[var(--sidebar-width)] border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--sidebar-border)] px-3">
        <div className="h-8 w-8 rounded-lg bg-[var(--sidebar-hover)]" />
        <div className="h-9 w-9 rounded-xl bg-[var(--sidebar-hover)]" />
        <div className="h-4 flex-1 rounded bg-[var(--sidebar-hover)]" />
      </div>
      <div className="space-y-2 p-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-lg bg-[var(--sidebar-hover)]" />
        ))}
      </div>
    </aside>
  );
}

function PageFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[var(--primary)]" />
    </div>
  );
}

/**
 * The page content always renders (so navigations are instant and Next.js can
 * validate each page); the session loads alongside it. Access control is enforced
 * by the proxy (redirects to /login without a session cookie) and by every API route.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/users/me");
    if (res.ok) setSession(await res.json());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setSession(data);
        else router.push("/login");
      })
      .catch(() => !cancelled && router.push("/login"));
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <SessionContext.Provider value={session}>
      <SessionRefreshContext.Provider value={refresh}>
      <TooltipProvider>
        <div className="min-h-screen bg-[var(--background)]">
          {session ? (
            <Sidebar user={session.user} company={session.company} role={session.membership.role} companies={session.companies} />
          ) : (
            <SidebarSkeleton />
          )}
          <main className="lg:pl-[var(--sidebar-current,var(--sidebar-width))] pt-14 lg:pt-0 transition-[padding] duration-200">
            <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] mx-auto">
              <Suspense fallback={<PageFallback />}>{children}</Suspense>
            </div>
          </main>
          <Toaster />
        </div>
      </TooltipProvider>
      </SessionRefreshContext.Provider>
    </SessionContext.Provider>
  );
}
