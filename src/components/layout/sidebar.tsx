"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, AlertTriangle, FolderOpen, Package, Upload,
  Users, History, Settings, Menu, X, ChevronDown, LogOut, User,
  Shield, Building2, PanelLeftClose, PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface SidebarProps {
  user: { display_name: string; email: string };
  company: { name: string; slug: string };
  role: string;
  companies?: Array<{ id: string; name: string; slug: string }>;
}

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["company_admin", "manager", "reviewer"] },
  { label: "Alerts", href: "/alerts", icon: AlertTriangle, roles: ["company_admin", "manager", "reviewer"] },
  { label: "Regulation Groups", href: "/groups", icon: FolderOpen, roles: ["company_admin", "manager", "reviewer"] },
  { label: "Product Inventory", href: "/products", icon: Package, roles: ["company_admin", "manager"] },
  { label: "Imports", href: "/imports", icon: Upload, roles: ["company_admin", "manager"] },
  { label: "Team", href: "/team", icon: Users, roles: ["company_admin"] },
  { label: "Audit History", href: "/audit", icon: History, roles: ["company_admin", "manager"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["company_admin"] },
];

const riskOwnerItems = [
  { label: "My Risks", href: "/my-risks", icon: Shield, roles: ["risk_owner"] },
];

export function Sidebar({ user, company, role, companies = [] }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const items = role === "risk_owner" ? riskOwnerItems : navItems.filter((item) => item.roles.includes(role));
  const initials = user.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Company switcher */}
      <div className={cn("flex items-center border-b border-[var(--border)] px-3 py-3", collapsed && "justify-center")}>
        {companies.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold hover:bg-[var(--accent)] transition-colors w-full", collapsed && "justify-center")}>
                <Building2 className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                {!collapsed && (
                  <>
                    <span className="truncate">{company.name}</span>
                    <ChevronDown className="ml-auto h-3 w-3 text-[var(--muted-foreground)]" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {companies.map((c) => (
                <DropdownMenuItem key={c.id} asChild>
                  <Link href={`/api/auth/switch-company?slug=${c.slug}`}>{c.name}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className={cn("flex items-center gap-2 px-2 py-1", collapsed && "justify-center")}>
            <Building2 className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            {!collapsed && <span className="truncate text-sm font-semibold">{company.name}</span>}
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-1 px-2 py-3" aria-label="Main navigation">
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <Separator />

      {/* Collapse toggle (desktop only) */}
      <div className="hidden lg:flex px-2 py-2">
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)} className="w-full" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      {/* User menu */}
      <div className={cn("border-t border-[var(--border)] px-3 py-3", collapsed && "px-2")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--accent)] transition-colors", collapsed && "justify-center")}>
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium leading-tight truncate">{user.display_name}</p>
                  <p className="text-xs text-[var(--muted-foreground)] truncate">{user.email}</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user.display_name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings"><User className="mr-2 h-4 w-4" /> Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action="/api/auth/logout" method="POST" className="w-full">
                <button type="submit" className="flex w-full items-center">
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
      {/* Mobile hamburger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center border-b border-[var(--border)] bg-[var(--background)] px-4 h-14">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
        <span className="ml-3 text-sm font-semibold">{company.name}</span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-72 bg-[var(--background)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 h-14">
              <span className="text-sm font-semibold">{company.name}</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </Button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 border-r border-[var(--border)] bg-[var(--background)] transition-all duration-200",
          collapsed ? "lg:w-16" : "lg:w-60"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
