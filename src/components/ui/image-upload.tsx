/* eslint-disable @next/next/no-img-element -- previews of local data-URL images */
"use client";

import { useRef, useState } from "react";
import { Upload, Trash2, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick an image, resize it in the browser and hand back a PNG/WebP data URL.
 * - mode "square": centre-crop to a square of `size` px (avatars, icons)
 * - mode "fit": keep the aspect ratio, fit inside maxWidth × maxHeight (wide logos)
 */
async function processImage(
  file: File,
  opts: { mode: "square" | "fit"; size: number; maxWidth: number; maxHeight: number; background?: string }
): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp|svg\+xml)$/.test(file.type)) throw new Error("Choose a PNG, JPG, WebP or SVG image");
  if (file.size > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MB");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read that image"));
      i.src = url;
    });
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";

    if (opts.mode === "square") {
      const s = Math.min(w, h);
      canvas.width = opts.size;
      canvas.height = opts.size;
      if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, opts.size, opts.size);
      }
      ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, opts.size, opts.size);
    } else {
      const scale = Math.min(1, opts.maxWidth / w, opts.maxHeight / h);
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    // SVGs are rasterised here, so only bitmap data is ever stored.
    const webp = canvas.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface ImageUploadProps {
  value?: string | null;
  onSave: (dataUrl: string | null) => Promise<void>;
  label: string;
  hint?: string;
  mode?: "square" | "fit";
  shape?: "circle" | "rounded" | "wide";
  /** Preview background (e.g. dark for a dark-background logo). */
  previewBg?: string;
  disabled?: boolean;
  fallback?: React.ReactNode;
}

export function ImageUpload({
  value,
  onSave,
  label,
  hint,
  mode = "square",
  shape = "rounded",
  previewBg,
  disabled,
  fallback,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const data = await processImage(file, { mode, size: 256, maxWidth: 600, maxHeight: 160 });
      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  };

  const previewCls =
    shape === "circle"
      ? "h-20 w-20 rounded-full"
      : shape === "wide"
      ? "h-16 w-48 rounded-xl px-3"
      : "h-20 w-20 rounded-2xl";

  return (
    <div className="flex items-center gap-4">
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-700",
          previewCls,
          !previewBg && "bg-slate-50 dark:bg-slate-800"
        )}
        style={previewBg ? { background: previewBg } : undefined}
      >
        {value ? (
          <img src={value} alt="" className={cn("h-full w-full", shape === "wide" ? "object-contain" : "object-cover")} />
        ) : (
          fallback ?? <ImageIcon className="h-6 w-6 text-slate-300" />
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-900/70">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
        {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
        {!disabled && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" /> {value ? "Change" : "Upload"}
            </button>
            {value && (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
        )}
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
