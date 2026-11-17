"use client";

import { createContext, useContext } from "react";

export interface SessionInfo {
  user: { id: string; display_name: string; email: string; preferences?: { avatar?: string } & Record<string, unknown> };
  membership: { id: string; company_id: string; role: string };
  company: { id: string; name: string; slug: string; settings?: { logo?: string; logo_dark?: string; icon?: string } & Record<string, unknown> };
  companies?: Array<{ id: string; name: string; slug: string; role?: string; logo?: string | null; icon?: string | null }>;
}

export const SessionContext = createContext<SessionInfo | null>(null);

/** Re-fetch the session (e.g. after changing your photo or the workspace logo). */
export const SessionRefreshContext = createContext<() => Promise<void>>(async () => {});

export function useRefreshSession() {
  return useContext(SessionRefreshContext);
}

/** Current user / workspace, provided by the dashboard layout. */
export function useSessionInfo() {
  return useContext(SessionContext);
}
