"use client";

import { useEffect, useState, useCallback } from "react";

interface Group {
  id: string;
  title: string;
  jurisdiction_ref: string | null;
  issuer: string | null;
  description: string | null;
  owner_name: string | null;
  alert_count: number;
  highest_priority: string | null;
  state: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  moderate: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  low: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
};

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", jurisdiction_ref: "", issuer: "", description: "" });
  const [creating, setCreating] = useState(false);

  const loadGroups = useCallback(async () => {
    const res = await fetch("/api/groups");
    const data = await res.json();
    setGroups(data.groups || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setShowCreate(false);
    setForm({ title: "", jurisdiction_ref: "", issuer: "", description: "" });
    setCreating(false);
    loadGroups();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Regulation Groups</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Organize alerts by regulation or policy</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          Create group
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Create regulation group</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Title</label>
                <input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Jurisdiction reference</label>
                <input type="text" value={form.jurisdiction_ref} onChange={(e) => setForm({ ...form, jurisdiction_ref: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Issuer</label>
                <input type="text" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">Cancel</button>
                <button type="submit" disabled={creating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors">
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-slate-500 dark:text-slate-400">
          <p className="text-lg font-medium">No regulation groups yet</p>
          <p className="text-sm mt-1">Create a group to organize related alerts</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3">Group</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Jurisdiction</th>
                <th className="text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3">Alerts</th>
                <th className="text-center text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Priority</th>
                <th className="text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-white text-sm">{g.title}</p>
                    {g.issuer && <p className="text-xs text-slate-500 dark:text-slate-400">{g.issuer}</p>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden md:table-cell">{g.jurisdiction_ref || "—"}</td>
                  <td className="px-4 py-3 text-center text-sm font-medium text-slate-900 dark:text-white">{g.alert_count}</td>
                  <td className="px-4 py-3 text-center hidden sm:table-cell">
                    {g.highest_priority ? (
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${PRIORITY_COLORS[g.highest_priority] || "bg-gray-100 text-gray-800"}`}>
                        {g.highest_priority}
                      </span>
                    ) : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 hidden lg:table-cell">{g.owner_name || <span className="text-slate-400">Unassigned</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
