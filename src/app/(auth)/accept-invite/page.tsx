"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [form, setForm] = useState({ email: "", password: "", display_name: "", confirm_password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "new" && form.password !== form.confirm_password) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mode, ...form }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to accept invitation"); return; }
      router.push("/dashboard");
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Invalid invitation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">This invitation link is missing or invalid.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Accept invitation</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Join the workspace</p>
      </div>
      <div className="flex gap-2 mb-6">
        <button onClick={() => setMode("existing")}
          className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${mode === "existing" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
          Existing account
        </button>
        <button onClick={() => setMode("new")}
          className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${mode === "new" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
          New account
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg p-3">{error}</div>}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
          <input id="email" type="email" required value={form.email} onChange={(e) => update("email", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        {mode === "new" && (
          <div>
            <label htmlFor="display_name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Display name</label>
            <input id="display_name" type="text" required value={form.display_name} onChange={(e) => update("display_name", e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        )}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
          <input id="password" type="password" required value={form.password} onChange={(e) => update("password", e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        </div>
        {mode === "new" && (
          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Confirm password</label>
            <input id="confirm_password" type="password" required value={form.confirm_password} onChange={(e) => update("confirm_password", e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        )}
        <button type="submit" disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors">
          {loading ? "Joining..." : "Join workspace"}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return <Suspense fallback={<div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center"><p>Loading...</p></div>}><AcceptInviteContent /></Suspense>;
}
