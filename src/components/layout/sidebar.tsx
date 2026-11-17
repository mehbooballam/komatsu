"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, AlertTriangle, FolderOpen, Package, Upload,
  Users, History, Settings, Menu, X, ChevronDown, LogOut, User,
  Shield, PanelLeftClose, PanelLeft, Moon, Sun, ChevronsUpDown, Check, Plus, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  companies?: Array<{ id: string; name: string; slug: string; role?: string; icon?: string | null }>;
}

type NavItem = { label: string; href: string; icon: React.ElementType; roles: string[] };

const navSections: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["company_admin", "manager", "reviewer"] },
      { label: "Alerts", href: "/alerts", icon: AlertTriangle, roles: ["company_admin", "manager", "reviewer"] },
      { label: "Regulation Groups", href: "/groups", icon: FolderOpen, roles: ["company_admin", "manager", "reviewer"] },
    ],
  },
  {
    title: "Data",
    items: [
      { label: "Imports", href: "/imports", icon: Upload, roles: ["company_admin", "manager"] },
      { label: "Product Inventory", href: "/products", icon: Package, roles: ["company_admin", "manager"] },
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
}: {
  current: { name: string; slug: string; settings?: Branding };
  companies: Array<{ id: string; name: string; slug: string; role?: string; icon?: string | null }>;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (companyId: string) => {
    setBusy(true);
    const res = await fetch("/api/workspaces/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId }),
    });
    if (res.ok) window.location.assign("/dashboard");
    else setBusy(false);
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
        <button className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left hover:bg-[var(--sidebar-hover)]">
          <span className="min-w-0 flex-1">
            {current.settings?.logo || current.settings?.logo_dark ? (
              <span className="block py-0.5">
                <WorkspaceLogo logo={current.settings.logo} logoDark={current.settings.logo_dark} name={current.name} className="h-[18px]" />
              </span>
            ) : (
              <span className="block truncate text-sm font-semibold text-[var(--sidebar-strong)]">{current.name}</span>
            )}
            <span className="block text-[11px] text-[var(--sidebar-muted)]">Regulatory Risk</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-strong)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-72 p-1.5">
        <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workspaces</p>
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
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-[11px] font-bold text-white">
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
                {error && <p className="text-xs text-red-600">{error}</p>}
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

export function Sidebar({ user, company, role, companies = [] }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggle } = useTheme();

  // Let the main content follow the sidebar width.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-current",
      collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)"
    );
  }, [collapsed]);

  const sections = (role === "risk_owner" ? riskOwnerSections : navSections)
    .map((s) => ({ ...s, items: s.items.filter((i) => i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);


  const renderContent = (isCollapsed: boolean, mobile = false) => (
    <div className="flex h-full flex-col text-[var(--sidebar-fg)]">
      {/* Top: collapse toggle + logo + workspace switcher */}
      <div className={cn("flex items-center gap-2 border-b border-[var(--sidebar-border)] px-3 h-16", isCollapsed && "flex-col justify-center gap-2 h-auto py-3 px-0")}>
        <button
          type="button"
          onClick={() => setCollapsed(!isCollapsed)}
          className="hidden lg:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-strong)]"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        </button>
        <WorkspaceIcon src={company.settings?.icon} name={company.name} />
        {!isCollapsed && (
          <WorkspaceSwitcher current={company} companies={companies} canCreate={role === "company_admin"} />
        )}
        {mobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-strong)]"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-muted)]">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-fg)]"
                        : "hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-strong)]",
                      isCollapsed && "justify-center px-0"
                    )}
                    title={isCollapsed ? item.label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-sky-400" />}
                    <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive ? "text-[var(--sidebar-accent)]" : "text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-strong)]")} />
                    {!isCollapsed && <span>{item.label}</span>}
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
              <span className={cn("relative h-4 w-7 rounded-full transition-colors", theme === "dark" ? "bg-sky-500" : "bg-[var(--sidebar-track)]")}>
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
              <Link href="/profile"><User className="mr-2 h-4 w-4" /> My profile</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile#password"><KeyRound className="mr-2 h-4 w-4" /> Change password</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action="/api/auth/logout" method="POST" className="w-full">
                <button type="submit" className="flex w-full items-center text-red-600">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 bg-[var(--sidebar-bg)] px-4 h-14 border-b border-[var(--sidebar-border)] shadow-sm">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="rounded-lg p-2 text-[var(--sidebar-strong)] hover:bg-[var(--sidebar-hover)]"
        >
          <Menu className="h-5 w-5" />
        </button>
        <WorkspaceIcon src={company.settings?.icon} name={company.name} className="h-7 w-7 rounded-lg" />
        <span className="text-sm font-semibold text-[var(--sidebar-strong)]">{company.name}</span>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[var(--sidebar-bg)] shadow-2xl">
            {renderContent(false, true)}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] transition-[width] duration-200",
          collapsed ? "lg:w-[var(--sidebar-collapsed-width)]" : "lg:w-[var(--sidebar-width)]"
        )}
      >
        {renderContent(collapsed)}
      </aside>
    </>
  );
}
