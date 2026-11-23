/**
 * Small images (profile photos, workspace logos) are stored inline as data URLs.
 * The browser crops/resizes them to 256×256 before upload, so they stay small.
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 400_000; // ~300 KB of image data

const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Returns an error message, or null if the value is an acceptable image (SVG is rejected). */
export function validateImageDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return "Image must be provided as a data URL";
  if (value.length > MAX_IMAGE_DATA_URL_LENGTH) return "Image is too large — use a smaller picture";
  if (!DATA_URL_RE.test(value)) return "Only PNG, JPEG or WebP images are supported";
  return null;
}
