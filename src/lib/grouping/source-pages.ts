import dns from "dns/promises";
import net from "net";
import { query } from "@/lib/db";

/**
 * Reads the title and description of each alert's source page, so grouping can use
 * the official name of the regulation. Only public http(s) addresses are fetched
 * (no private or local networks), with a short timeout and a size limit.
 */

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 8000;
const CONCURRENCY = 5;
// Pages read in the last 30 days are not read again
const REFRESH_DAYS = 30;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function safeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();

function meta(html: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decode(content).slice(0, 600);
  }
  return null;
}

export async function readPage(raw: string): Promise<{ title: string | null; description: string | null } | null> {
  let url = await safeUrl(raw);
  // Follow up to 3 redirects by hand so every hop is checked
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "RiskOrbit regulatory grouping (page title reader)", Accept: "text/html,application/xhtml+xml" },
    }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") || "").includes("html") || !res.body) return null;
    // Read at most MAX_BYTES
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf8");
    const title =
      meta(html, ["og:title", "twitter:title", "citation_title", "dc.title"]) ??
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]).slice(0, 400) : null) ??
      (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ? decode(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)![1].replace(/<[^>]+>/g, " ")).slice(0, 400) : null);
    const description = meta(html, ["description", "og:description", "twitter:description", "dc.description"]);
    return { title: title || null, description };
  }
  return null;
}

/** Reads pages for alerts that have a link and no recent reading. Returns how many were read. */
export async function refreshSourcePages(companyId: string, alertIds: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  if (!alertIds.length) return 0;
  const res = await query(
    `SELECT id, source_url FROM alerts
     WHERE company_id = $1 AND id = ANY($2::uuid[]) AND source_url IS NOT NULL AND source_url <> ''
       AND (source_page_fetched_at IS NULL OR source_page_fetched_at < now() - ($3 || ' days')::interval)`,
    [companyId, alertIds, String(REFRESH_DAYS)]
  );
  const todo: Array<{ id: string; source_url: string }> = [...res.rows];
  const total = todo.length;
  let done = 0;
  let read = 0;
  const worker = async () => {
    for (let item = todo.shift(); item; item = todo.shift()) {
      const page = await readPage(item.source_url).catch(() => null);
      await query(
        `UPDATE alerts SET source_page_title = $2, source_page_description = $3, source_page_fetched_at = now() WHERE id = $1`,
        [item.id, page?.title ?? null, page?.description ?? null]
      );
      if (page?.title) read++;
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return read;
}
