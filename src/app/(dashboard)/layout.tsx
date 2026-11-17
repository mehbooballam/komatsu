"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Toaster } from "@/components/layout/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

interface SessionData {
  user: { id: string; display_name: string; email: string };
  membership: { id: string; company_id: string; role: string };
  company: { id: string; name: string; slug: string };
  companies?: Array<{ id: string; name: string; slug: string }>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/login");
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setSession(data);
        setLoading(false);
      })
      .catch(() => {
        router.push("/login");
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--primary)]" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[var(--background)]">
        <Sidebar
          user={session.user}
          company={session.company}
          role={session.membership.role}
          companies={session.companies}
        />
        <main className="lg:pl-60 pt-14 lg:pt-0">
          <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
