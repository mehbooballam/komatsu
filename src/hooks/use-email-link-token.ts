"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function readFragment() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

function readServerFragment() {
  return null;
}

export function useEmailLinkToken() {
  const legacyToken = useSearchParams().get("token");
  const token = useSyncExternalStore(subscribe, readFragment, readServerFragment);
  return token ?? legacyToken ?? "";
}
