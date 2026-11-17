"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [result, setResult] = useState<{ status: "loading" | "success" | "error"; message: string }>(
    token ? { status: "loading", message: "" } : { status: "error", message: "Missing verification token." }
  );
  const { status, message } = result;

  useEffect(() => {
    if (!token) return;
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setResult({ status: "success", message: "Email verified successfully!" });
        else setResult({ status: "error", message: data.error || "Verification failed." });
      })
      .catch(() => setResult({ status: "error", message: "Network error." }));
  }, [token]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
      {status === "loading" && <p className="text-slate-500 dark:text-slate-400">Verifying your email...</p>}
      {status === "success" && (
        <>
          <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{message}</h1>
          <Link href="/login" className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">Sign in</Link>
        </>
      )}
      {status === "error" && (
        <>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Verification failed</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
          <Link href="/login" className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">Sign in</Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-8 text-center"><p>Loading...</p></div>}><VerifyContent /></Suspense>;
}
