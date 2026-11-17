"use client";

import React, { useEffect, useState } from "react";
import { UserRound, KeyRound, Eye, EyeOff, Check, X, Loader2, ShieldCheck, Building2 } from "lucide-react";
import { useSessionInfo, useRefreshSession } from "@/components/layout/session-context";
import { UserAvatar } from "@/components/ui/brand";
import { ImageUpload } from "@/components/ui/image-upload";

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Administrator",
  manager: "Manager",
  reviewer: "Reviewer",
  risk_owner: "Risk owner",
};

const RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "A number", test: (p: string) => /[0-9]/.test(p) },
];

const inputCls =
  "mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

function Section({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="panel p-5 sm:p-6">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete: string;
  id: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`${inputCls} pr-10`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <div
      role={msg.ok ? "status" : "alert"}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        msg.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
      }`}
    >
      {msg.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />} {msg.text}
    </div>
  );
}

export default function ProfilePage() {
  const session = useSessionInfo();
  const refreshSession = useRefreshSession();

  // Profile form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Password form
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (session) {
      setName(session.user.display_name); // eslint-disable-line react-hooks/set-state-in-effect
      setEmail(session.user.email);
    }
  }, [session]);

  if (!session) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    );
  }

  const emailChanged = email.trim().toLowerCase() !== session.user.email.toLowerCase();
  const nameChanged = name.trim() !== session.user.display_name;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await fetch("/api/users/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: name,
        email,
        current_password: emailChanged ? emailPassword : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingProfile(false);
    if (!res.ok) {
      setProfileMsg({ ok: false, text: body.error || "Could not save your profile" });
      return;
    }
    setEmailPassword("");
    setProfileMsg({ ok: true, text: emailChanged ? "Profile saved. Use your new email next time you sign in." : "Profile saved" });
    await refreshSession();
  };

  const rulesOk = RULES.every((r) => r.test(next));
  const matches = next.length > 0 && next === confirm;
  const canChangePw = current.length > 0 && rulesOk && matches && !savingPw;

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canChangePw) return;
    setSavingPw(true);
    setPwMsg(null);
    const res = await fetch("/api/users/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: current, new_password: next }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPw(false);
    if (!res.ok) {
      setPwMsg({ ok: false, text: body.error || "Could not change your password" });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setPwMsg({
      ok: true,
      text:
        body.other_sessions_ended > 0
          ? `Password changed. Signed out ${body.other_sessions_ended} other session${body.other_sessions_ended === 1 ? "" : "s"}.`
          : "Password changed",
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <UserAvatar name={session.user.display_name} src={session.user.preferences?.avatar} className="h-16 w-16 text-xl shadow-lg shadow-sky-500/20" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{session.user.display_name}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {session.user.email} · {ROLE_LABELS[session.membership.role] || session.membership.role} in {session.company.name}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profile */}
        <Section title="Profile" subtitle="Your photo, name and sign-in email" icon={UserRound}>
          <div className="mb-5 border-b border-[var(--border)] pb-5">
            <ImageUpload
              label="Profile photo"
              hint="Square images work best. Shown in the sidebar and wherever you're an owner."
              shape="circle"
              mode="square"
              value={session.user.preferences?.avatar}
              fallback={<UserAvatar name={session.user.display_name} className="h-20 w-20 text-2xl" />}
              onSave={async (image) => {
                const res = await fetch("/api/users/me/avatar", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image }),
                });
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save photo");
                await refreshSession();
              }}
            />
          </div>
          <form onSubmit={saveProfile} className="space-y-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Full name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} className={inputCls} />
            </label>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputCls} />
              <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">You sign in with this address.</span>
            </label>
            {emailChanged && (
              <label htmlFor="email-pw" className="block rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm font-medium text-slate-700 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-slate-300">
                Confirm with your current password
                <PasswordInput id="email-pw" value={emailPassword} onChange={setEmailPassword} autoComplete="current-password" placeholder="Current password" />
              </label>
            )}
            <Message msg={profileMsg} />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingProfile || (!nameChanged && !emailChanged) || (emailChanged && !emailPassword)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />} Save profile
              </button>
            </div>
          </form>
        </Section>

        {/* Password */}
        <div id="password" className="scroll-mt-6">
        <Section title="Change password" subtitle="Other signed-in devices will be signed out" icon={KeyRound}>
          <form onSubmit={changePassword} className="space-y-4">
            {/* hidden username helps password managers */}
            <input type="email" value={session.user.email} autoComplete="username" readOnly hidden />
            <label htmlFor="pw-current" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Current password
              <PasswordInput id="pw-current" value={current} onChange={setCurrent} autoComplete="current-password" />
            </label>
            <label htmlFor="pw-new" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              New password
              <PasswordInput id="pw-new" value={next} onChange={setNext} autoComplete="new-password" />
            </label>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {RULES.map((r) => {
                const ok = r.test(next);
                return (
                  <li key={r.label} className={`flex items-center gap-1.5 ${ok ? "text-emerald-600" : "text-slate-400"}`}>
                    {ok ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />} {r.label}
                  </li>
                );
              })}
            </ul>
            <label htmlFor="pw-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Confirm new password
              <PasswordInput id="pw-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              {confirm.length > 0 && !matches && <span className="mt-1 block text-xs font-normal text-red-600">Passwords don&apos;t match</span>}
            </label>
            <Message msg={pwMsg} />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canChangePw}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                {savingPw && <Loader2 className="h-4 w-4 animate-spin" />} Change password
              </button>
            </div>
          </form>
        </Section>
        </div>
      </div>

      {/* Account */}
      <Section title="Account" subtitle="Workspaces you belong to" icon={ShieldCheck}>
        <ul className="divide-y divide-[var(--border)]">
          {(session.companies?.length ? session.companies : [{ ...session.company, role: session.membership.role }]).map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm font-medium text-slate-900 dark:text-white">{c.name}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {ROLE_LABELS[c.role || ""] || c.role}
              </span>
              {c.id === session.company.id && <span className="text-xs font-medium text-blue-600">Current</span>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
