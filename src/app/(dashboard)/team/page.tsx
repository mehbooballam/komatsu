"use client";

import { useEffect, useState, useCallback } from "react";

interface Member {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  state: string;
  joined_at: string;
  teams: string[];
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  state: string;
  created_at: string;
  expires_at: string;
}

interface Team {
  id: string;
  name: string;
  member_count: number;
}

/** A password that passes the strength rules: 14 characters with upper, lower and digits. */
function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnopqrstuvwxyz", digits = "23456789";
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 11 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const fieldCls = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none";

const ROLES = [
  { value: "company_admin", label: "Company Administrator" },
  { value: "manager", label: "Manager" },
  { value: "reviewer", label: "Reviewer" },
  { value: "risk_owner", label: "Risk Owner" },
];

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "reviewer" });
  const [teamForm, setTeamForm] = useState({ name: "" });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"members" | "invitations" | "teams">("members");
  // Set up a user directly (no invitation email)
  const [showSetup, setShowSetup] = useState(false);
  const [setupForm, setSetupForm] = useState({ display_name: "", email: "", role: "reviewer", password: "", team_ids: [] as string[] });
  const [showPw, setShowPw] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [membersRes, invitationsRes, teamsRes] = await Promise.all([
      fetch("/api/teams/members"),
      fetch("/api/invitations"),
      fetch("/api/teams"),
    ]);
    const [mData, iData, tData] = await Promise.all([membersRes.json(), invitationsRes.json(), teamsRes.json()]);
    setMembers(mData.members || []);
    setInvitations(iData.invitations || []);
    setTeams(tData.teams || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/teams/members"), fetch("/api/invitations"), fetch("/api/teams")])
      .then((responses) => Promise.all(responses.map((r) => r.json().catch(() => ({})))))
      .catch(() => [{}, {}, {}])
      .then(([mData, iData, tData]) => {
        if (cancelled) return;
        setMembers(mData.members || []);
        setInvitations(iData.invitations || []);
        setTeams(tData.teams || []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inviteForm),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { alert(data.error || "Failed to invite"); return; }
    setShowInvite(false);
    setInviteForm({ email: "", role: "reviewer" });
    load();
  }

  function openSetup() {
    setSetupForm({ display_name: "", email: "", role: "reviewer", password: generatePassword(), team_ids: [] });
    setShowPw(true);
    setSetupError(null);
    setShowSetup(true);
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSetupError(null);
    const res = await fetch("/api/teams/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupForm),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setSetupError(data.error || "Could not set up the user");
      return;
    }
    setShowSetup(false);
    setCreated({ name: setupForm.display_name || setupForm.email, email: setupForm.email, password: data.new_account ? setupForm.password : null });
    setCopied(false);
    load();
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamForm) });
    setShowCreateTeam(false);
    setTeamForm({ name: "" });
    setSaving(false);
    load();
  }

  async function revokeInvitation(id: string) {
    if (!confirm("Revoke this invitation?")) return;
    await fetch(`/api/invitations/${id}`, { method: "DELETE" });
    load();
  }

  async function revokeMember(id: string) {
    if (!confirm("Revoke this member's access?")) return;
    await fetch(`/api/teams/members/${id}`, { method: "DELETE" });
    load();
  }

  const roleLabel = (role: string) => ROLES.find((r) => r.value === role)?.label || role;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Team</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Manage members, invitations and teams</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateTeam(true)}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            Create team
          </button>
          <button onClick={() => setShowInvite(true)}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">
            Invite by email
          </button>
          <button onClick={openSetup}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            Set up user
          </button>
        </div>
      </div>

      {/* Invite dialog */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Invite team member</h2>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                <input type="email" required value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none">
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowInvite(false)} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">{saving ? "Sending..." : "Send invitation"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Set up user dialog */}
      {showSetup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Set up user">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 max-h-[92vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Set up user</h2>
            <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">Creates the account straight away — no invitation email. Share the sign-in details with them; they can change the password in their profile.</p>
            <form onSubmit={handleSetup} className="space-y-4">
              <div>
                <label htmlFor="su-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input id="su-name" type="text" required value={setupForm.display_name} onChange={(e) => setSetupForm({ ...setupForm, display_name: e.target.value })} className={fieldCls} />
              </div>
              <div>
                <label htmlFor="su-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email (used to sign in)</label>
                <input id="su-email" type="email" required value={setupForm.email} onChange={(e) => setSetupForm({ ...setupForm, email: e.target.value })} className={fieldCls} />
              </div>
              <div>
                <label htmlFor="su-role" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                <select id="su-role" value={setupForm.role} onChange={(e) => setSetupForm({ ...setupForm, role: e.target.value })} className={fieldCls}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="su-pw" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                <div className="flex gap-2">
                  <input id="su-pw" type={showPw ? "text" : "password"} required autoComplete="new-password" value={setupForm.password}
                    onChange={(e) => setSetupForm({ ...setupForm, password: e.target.value })} className={`${fieldCls} font-mono`} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="shrink-0 px-3 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">{showPw ? "Hide" : "Show"}</button>
                  <button type="button" onClick={() => { setSetupForm({ ...setupForm, password: generatePassword() }); setShowPw(true); }} className="shrink-0 px-3 text-sm text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700">New</button>
                </div>
                <p className="mt-1 text-xs text-slate-500">At least 8 characters with an upper-case letter, a lower-case letter and a number. Not used if the email already has an account.</p>
              </div>
              {teams.length > 0 && (
                <fieldset>
                  <legend className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Teams (optional)</legend>
                  <div className="flex flex-wrap gap-2">
                    {teams.map((t) => {
                      const on = setupForm.team_ids.includes(t.id);
                      return (
                        <label key={t.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm cursor-pointer ${on ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300" : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>
                          <input type="checkbox" className="accent-blue-600" checked={on}
                            onChange={() => setSetupForm({ ...setupForm, team_ids: on ? setupForm.team_ids.filter((x) => x !== t.id) : [...setupForm.team_ids, t.id] })} />
                          {t.name}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {setupError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{setupError}</p>}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowSetup(false)} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">{saving ? "Setting up..." : "Set up user"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sign-in details after setup (shown once) */}
      {created && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="User set up">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{created.name} is set up</h2>
            {created.password ? (
              <>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Share these sign-in details securely. The password is not shown again.</p>
                <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Email</dt><dd className="font-medium text-slate-900 dark:text-white break-all">{created.email}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Password</dt><dd className="font-mono font-medium text-slate-900 dark:text-white break-all">{created.password}</dd></div>
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`Sign in at ${window.location.origin}/login\nEmail: ${created.email}\nPassword: ${created.password}`).then(() => setCopied(true));
                  }}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {copied ? "Copied" : "Copy sign-in details"}
                </button>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">This email already had an account, so it was added to this workspace. They sign in with their existing password.</p>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={() => setCreated(null)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Create team dialog */}
      {showCreateTeam && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Create team</h2>
            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Team name</label>
                <input type="text" required value={teamForm.name} onChange={(e) => setTeamForm({ name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowCreateTeam(false)} className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg">{saving ? "Creating..." : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-6">
        {(["members", "invitations", "teams"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize
              ${tab === t ? "border-blue-600 text-blue-600 dark:text-blue-400" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"}`}>
            {t} {t === "members" ? `(${members.length})` : t === "invitations" ? `(${invitations.filter((i) => i.state === "pending").length})` : `(${teams.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}</div>
      ) : tab === "members" ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Member</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Role</th>
                <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Status</th>
                <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{m.display_name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{m.email}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden sm:table-cell">{roleLabel(m.role)}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${m.state === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-slate-100 text-slate-500"}`}>{m.state}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.state === "active" && (
                      <button onClick={() => revokeMember(m.id)} className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 font-medium">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "invitations" ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {invitations.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">No invitations</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Role</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-white">{inv.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden sm:table-cell">{roleLabel(inv.role)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${inv.state === "pending" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{inv.state}</span></td>
                    <td className="px-4 py-3 text-right">
                      {inv.state === "pending" && (
                        <button onClick={() => revokeInvitation(inv.id)} className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 font-medium">Revoke</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {teams.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-sm">No teams created yet</div>
          ) : teams.map((t) => (
            <div key={t.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">{t.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t.member_count} members</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
