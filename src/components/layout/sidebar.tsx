"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, AlertTriangle, FolderOpen, Package, Upload,
  Users, History, Settings, Menu, ChevronDown, ChevronRight, LogOut, User,
  Shield, FileText, Moon, Sun, ChevronsUpDown, Check, Plus, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { workspaceHome } from "@/lib/auth/permissions";
import {
  COLLAPSED_SIDEBAR_WIDTH, DESKTOP_SIDEBAR_KEY, MOBILE_MENU_KEY,
  readSidebarPreference, writeSidebarPreference,
} from "@/lib/sidebar-preferences";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar, WorkspaceIcon, WorkspaceLogo } from "@/components/ui/brand";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Branding = { logo?: string; logo_dark?: string; icon?: string } & Record<string, unknown>;

interface SidebarProps {
  user: { display_name: string; email: string; preferences?: { avatar?: string } & Record<string, unknown> };
  company: { name: string; slug: string; settings?: Branding };
  role: string;
  workspaceWide: boolean;
  companies?: Array<{ id: string; name: string; slug: string; role?: string; icon?: string | null }>;
}

/** Monthly Reports menu entry — switch to true to show it in the sidebar. */
const SHOW_REPORTS_MENU = true;

type NavItem = { label: string; href: string; icon: React.ElementType; roles: string[] };

const navSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["company_admin", "manager", "reviewer"] },
      { label: "Alerts", href: "/alerts", icon: AlertTriangle, roles: ["company_admin", "manager", "reviewer"] },
      { label: "Regulation Groups", href: "/groups", icon: FolderOpen, roles: ["company_admin", "manager", "reviewer"] },
      // Hidden until the client demo is done; the pages stay reachable at /reports.
      ...(SHOW_REPORTS_MENU ? [{ label: "Monthly Reports", href: "/reports", icon: FileText, roles: ["company_admin", "manager", "reviewer"] }] : []),
    ],
  },
  {
    title: "Data",
    items: [
      { label: "Imports", href: "/imports", icon: Upload, roles: ["company_admin", "manager"] },
      { label: "Products", href: "/products", icon: Package, roles: ["company_admin", "manager"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Team", href: "/team", icon: Users, roles: ["company_admin"] },
      { label: "Audit History", href: "/audit", icon: History, roles: ["company_admin", "manager"] },
      { label: "Settings", href: "/settings", icon: Settings, roles: ["company_admin"] },
    ],
  },
];

const riskOwnerSections: Array<{ title: string; items: NavItem[] }> = [
  { title: "Overview", items: [{ label: "My Risks", href: "/my-risks", icon: Shield, roles: ["risk_owner"] }] },
];

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Administrator",
  manager: "Manager",
  reviewer: "Reviewer",
  risk_owner: "Risk owner",
};

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    // Sync with the attribute set by the pre-paint script in the root layout.
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    if (current !== "light") setTheme(current); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };
  return { theme, toggle };
}

function WorkspaceSwitcher({
  current,
  companies,
  canCreate,
  compact = false,
}: {
  current: { name: string; slug: string; settings?: Branding };
  companies: Array<{ id: string; name: string; slug: string; role?: string; icon?: string | null }>;
  canCreate: boolean;
  /** Collapsed sidebar: show only the workspace icon */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (companyId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not switch workspace");
      window.location.assign(workspaceHome(body.membership?.role ?? "", body.membership?.access_scope ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch workspace");
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) window.location.assign("/dashboard");
    else {
      setError(body.error || "Could not create workspace");
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCreating(false); setError(null); } }}>
      <PopoverTrigger asChild>
        {compact ? (
          <button
            aria-label={`Workspace: ${current.name}. Switch workspace`}
            title={current.name}
            className="rounded-lg p-0.5 ring-1 ring-[var(--sidebar-border)] hover:ring-[var(--sidebar-accent)]"
          >
            <WorkspaceIcon src={current.settings?.icon} name={current.name} className="h-8 w-8" />
          </button>
        ) : (
          <button
            aria-label={`Workspace: ${current.name}. Switch workspace`}
            className="group flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-[var(--sidebar-border)] px-2.5 py-2 text-left transition-colors hover:border-[var(--sidebar-accent)] hover:bg-[var(--sidebar-hover)]"
          >
            <WorkspaceIcon src={current.settings?.icon} name={current.name} className="h-8 w-8" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted)]">Workspace</span>
              {current.settings?.logo || current.settings?.logo_dark ? (
                <span className="mt-0.5 block">
                  <WorkspaceLogo logo={current.settings.logo} logoDark={current.settings.logo_dark} name={current.name} className="h-[15px]" />
                </span>
              ) : (
                <span className="block truncate text-sm font-semibold text-[var(--sidebar-strong)]">{current.name}</span>
              )}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-strong)]" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-72 p-1.5">
        <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workspaces</p>
        {error && <p role="alert" className="px-2.5 pb-1.5 text-xs text-red-600">{error}</p>}
        {companies.map((c) => {
          const active = c.slug === current.slug;
          return (
            <button
              key={c.id}
              disabled={busy || active}
              onClick={() => go(c.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 disabled:cursor-default dark:hover:bg-slate-800"
            >
              {c.icon ? (
                <WorkspaceIcon src={c.icon} name={c.name} className="h-7 w-7 rounded-lg" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 text-[11px] font-bold text-white">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                {c.role && <span className="block text-xs capitalize text-slate-500">{(ROLE_LABELS[c.role] || c.role).toLowerCase()}</span>}
              </span>
              {active && <Check className="h-4 w-4 text-blue-600" />}
            </button>
          );
        })}
        {canCreate && (
          <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
            {creating ? (
              <form onSubmit={create} className="space-y-2 p-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace name, e.g. Komatsu Europe"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900"
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setCreating(false)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                    Create workspace
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">Copies the scoring policy and product families. Alerts start empty.</p>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                <Plus className="h-4 w-4" /> New workspace
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RiskOrbitBrand({ href, compact = false, onClick }: { href: string; compact?: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      aria-label="RiskOrbit by Infogenic Solutions — home"
      className={cn("flex h-11 w-fit items-center", compact && "w-10 justify-center")}
      onClick={onClick}
    >
      {compact ? (
        <img src="/brand/riskorbit-mark.png" alt="" className="h-7 w-7 object-contain" />
      ) : (
        <span className="block w-fit">
          <img src="/brand/riskorbit-logo.png" alt="" className="h-7 w-auto dark:hidden" />
          <img src="/brand/riskorbit-logo-dark.png" alt="" className="hidden h-7 w-auto dark:block" />
          {/* Starts under the wordmark ("Risk Orbit"), clear of the orbit mark */}
          <span className="mt-1 block whitespace-nowrap pl-[35px] text-[9.5px] font-medium leading-none text-[var(--sidebar-muted)]">
            by <span className="font-semibold text-[var(--sidebar-gold)]">Infogenic Solutions</span>
          </span>
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ user, company, role, workspaceWide, companies = [] }: SidebarProps) {
  const pathname = usePathname();
  const logoutForm = useRef<HTMLFormElement>(null);
  const [collapsed, setCollapsed] = useState(() => readSidebarPreference(DESKTOP_SIDEBAR_KEY));
  const [mobileOpen, setMobileOpen] = useState(() => readSidebarPreference(MOBILE_MENU_KEY));
  const { theme, toggle } = useTheme();
  const homeHref = workspaceHome(role, workspaceWide ? "company" : "assigned");
  const sidebarWidth = collapsed ? COLLAPSED_SIDEBAR_WIDTH : "var(--sidebar-width)";

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarPreference(DESKTOP_SIDEBAR_KEY, next);
  };

  const updateMobileMenu = (open: boolean) => {
    setMobileOpen(open);
    writeSidebarPreference(MOBILE_MENU_KEY, open);
  };
  const closeMobileMenu = () => updateMobileMenu(false);

  // Let the main content follow the sidebar width.
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-current", sidebarWidth);
  }, [sidebarWidth]);

  const sections = (role === "risk_owner" ? riskOwnerSections : navSections)
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => i.roles.includes(role) && (workspaceWide || !["/dashboard", "/groups", "/reports"].includes(i.href))),
    }))
    .filter((s) => s.items.length > 0);


  const renderContent = (isCollapsed: boolean, onNavigate?: () => void) => (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--sidebar-fg)]">
      {/* Workspace (below the product brand) */}
      <div className={cn("px-3 pt-3", isCollapsed && "flex justify-center px-0")}>
        <WorkspaceSwitcher current={company} companies={companies} canCreate={role === "company_admin"} compact={isCollapsed} />
      </div>

      {/* Nav */}
      <nav
        className={cn("flex-1 overflow-y-auto", isCollapsed ? "space-y-3 px-0.5 py-3 [scrollbar-width:thin]" : "space-y-5 px-3 py-4")}
        aria-label="Main navigation"
      >
        {sections.map((section) => (
          <div key={section.title}>
            <p className={cn(
              "mb-1.5 font-semibold uppercase text-[var(--sidebar-muted)]",
              isCollapsed ? "text-center text-[9px]" : "px-3 text-[10px] tracking-wider"
            )}>
              {isCollapsed && section.title === "Administration" ? "Admin" : section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
                      isCollapsed ? "justify-center" : "gap-3 px-3",
                      isActive
                        ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-fg)]"
                        : "hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-strong)]",
                    )}
                    title={isCollapsed ? item.label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[var(--sidebar-gold)]" />}
                    <item.icon aria-hidden="true" className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-[var(--sidebar-accent)]" : "text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-strong)]")} />
                    <span className={isCollapsed ? "sr-only" : undefined}>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: theme toggle (switches the whole app, sidebar included) */}
      <div className={cn("px-3 pb-2", isCollapsed && "flex justify-center")}>
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-strong)]",
            isCollapsed && "w-auto justify-center"
          )}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              <span className={cn("relative h-4 w-7 rounded-full transition-colors", theme === "dark" ? "bg-blue-500" : "bg-[var(--sidebar-track)]")}>
                <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", theme === "dark" ? "left-3.5" : "left-0.5")} />
              </span>
            </>
          )}
        </button>
      </div>

      {/* User */}
      <div className={cn("border-t border-[var(--sidebar-border)] p-3", isCollapsed && "px-2")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--sidebar-hover)] transition-colors", isCollapsed && "justify-center px-0")}>
              <UserAvatar name={user.display_name} src={user.preferences?.avatar} className="h-9 w-9 text-xs" />
              {!isCollapsed && (
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-[var(--sidebar-strong)]">{user.display_name}</p>
                  <p className="truncate text-[11px] text-[var(--sidebar-muted)]">{ROLE_LABELS[role] || role}</p>
                </div>
              )}
              {!isCollapsed && <ChevronDown className="h-4 w-4 text-[var(--sidebar-muted)]" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-60">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user.display_name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" onClick={onNavigate}><User className="mr-2 h-4 w-4" /> My profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile#password" onClick={onNavigate}><KeyRound className="mr-2 h-4 w-4" /> Change password</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600" onSelect={() => logoutForm.current?.requestSubmit()}>
              <LogOut aria-hidden="true" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <>
      <form ref={logoutForm} action="/api/auth/logout" method="POST" hidden />
      {/* Tablet and mobile top bar */}
      <div className="print:hidden fixed inset-x-0 top-0 z-40 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-3 shadow-sm lg:hidden">
        <button
          type="button"
          onClick={() => updateMobileMenu(!mobileOpen)}
          aria-controls="mobile-sidebar"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--sidebar-strong)] hover:bg-[var(--sidebar-hover)] aria-expanded:bg-[var(--sidebar-hover)]"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
        <RiskOrbitBrand href={homeHref} onClick={closeMobileMenu} />
      </div>

      {/* Mobile drawer */}
      <div id="mobile-sidebar" className="lg:hidden">
        {mobileOpen && (
          <div className="fixed inset-x-0 bottom-0 top-14 z-50">
            <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeMobileMenu} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[var(--sidebar-bg)] shadow-2xl">
              {renderContent(false, closeMobileMenu)}
            </div>
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside
        id="desktop-sidebar"
        className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] transition-[width] duration-200"
        style={{ width: sidebarWidth }}
      >
        <div className="relative flex h-16 shrink-0 items-center justify-center border-b border-[var(--sidebar-border)]">
          <RiskOrbitBrand href={homeHref} compact={collapsed} />
          <button
            type="button"
            onClick={toggleSidebar}
            aria-controls="desktop-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-white shadow-sm ring-2 ring-[var(--sidebar-bg)] transition-colors hover:bg-[var(--primary)] dark:text-[var(--sidebar-bg)]"
          >
            <ChevronRight aria-hidden="true" className={cn("size-4 motion-safe:transition-transform", !collapsed && "rotate-180")} />
          </button>
        </div>
        {renderContent(collapsed)}
      </aside>
    </>
  );
}
