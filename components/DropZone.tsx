"use client";
import { useRef, useState } from "react";
import { normalizeImage, putAsset } from "@/lib/storage";
import { AssetImage } from "./BookPage";
export default function DropZone({
  images,
  onChange,
  primary,
  onPrimary,
  disabled = false,
}: {
  images: string[];
  onChange: (ids: string[]) => void;
  primary?: string;
  onPrimary?: (id: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files || disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const ids = [];
      for (const file of Array.from(files))
        ids.push(await putAsset(await normalizeImage(file)));
      onChange([...images, ...ids]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  return (
    <div>
      <button
        type="button"
        className="drop-zone"
        disabled={disabled || busy}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <span>↥</span>
        <strong>{busy ? "Saving your photos…" : "Drop photos here"}</strong>
        <small>or click to browse · JPG, PNG, WEBP</small>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="thumbnails">
        {images.map((id, i) => (
          <div key={id} className="thumbnail">
            <AssetImage id={id} alt={`Reference photo ${i + 1}`} />
            <div>
              {onPrimary && (
                <button
                  disabled={disabled}
                  onClick={() => onPrimary(id)}
                  aria-label={`Use photo ${i + 1} as primary`}
                >
                  {primary === id ? "★ Primary" : "☆ Primary"}
                </button>
              )}
              <button
                disabled={disabled}
                onClick={() => onChange(images.filter((x) => x !== id))}
                aria-label={`Remove photo ${i + 1}`}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
