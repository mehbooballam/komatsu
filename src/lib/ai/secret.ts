import crypto from "crypto";

/**
 * Encrypts stored provider API keys (AES-256-GCM).
 * The key comes from AI_SETTINGS_SECRET, or is derived from NEXTAUTH_SECRET.
 * Changing that secret makes saved API keys unreadable (they must be entered again).
 */
function key(): Buffer {
  const secret = process.env.AI_SETTINGS_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("Set AI_SETTINGS_SECRET (or NEXTAUTH_SECRET) to store API keys");
  return crypto.createHash("sha256").update(`ai-settings:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(":").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
