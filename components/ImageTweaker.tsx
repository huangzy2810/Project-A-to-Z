"use client";
import { useRef, useState } from "react";
import { AssetImage } from "./BookPage";
import { ImageRegion, validRegion } from "@/lib/regions";
export default function ImageTweaker({
  image,
  disabled,
  sampleMode,
  onApply,
}: {
  image: string;
  disabled: boolean;
  sampleMode: boolean;
  onApply: (feedback: string, region: ImageRegion) => Promise<boolean>;
}) {
  const [region, setRegion] = useState<ImageRegion | null>(null);
  const [feedback, setFeedback] = useState("");
  const start = useRef<{ x: number; y: number } | null>(null);
  function point(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }
  function begin(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event);
    setRegion({ ...start.current, width: 0, height: 0 });
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!start.current || disabled) return;
    const end = point(event);
    setRegion({
      x: Math.min(start.current.x, end.x),
      y: Math.min(start.current.y, end.y),
      width: Math.abs(end.x - start.current.x),
      height: Math.abs(end.y - start.current.y),
    });
  }
  function finish() {
    start.current = null;
    setRegion((r) => (r && r.width >= 0.005 && r.height >= 0.005 ? r : null));
  }
  function number(key: keyof ImageRegion, value: number) {
    const next = {
      ...(region || { x: 0.25, y: 0.25, width: 0.3, height: 0.3 }),
      [key]: Math.max(
        key === "width" || key === "height" ? 0.01 : 0,
        Math.min(1, value / 100),
      ),
    };
    next.width = Math.min(next.width, 1 - next.x);
    next.height = Math.min(next.height, 1 - next.y);
    setRegion(next);
  }
  return (
    <div className="image-tweaker">
      <p className="help">
        Mark the area to repair, then tell us what to change. Everything outside
        the rectangle stays unchanged. Story text is kept separate. For a face
        repair, check the matching character above so their current approved
        face sheet is included.
      </p>
      <div
        className="tweak-canvas"
        aria-label="Illustration area selector"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <AssetImage id={image} alt="Illustration to tweak" />
        {region && (
          <div
            className="tweak-selection"
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        )}
      </div>
      <div className="actions">
        <button
          disabled={disabled}
          onClick={() =>
            setRegion({ x: 0.25, y: 0.25, width: 0.3, height: 0.3 })
          }
        >
          Select center area
        </button>
        <button disabled={disabled || !region} onClick={() => setRegion(null)}>
          Clear selection
        </button>
      </div>
      <fieldset disabled={disabled}>
        <div className="tweak-coordinates">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key}>
              {{ x: "Left", y: "Top", width: "Width", height: "Height" }[key]}{" "}
              (%)
              <input
                type="number"
                min={key === "width" || key === "height" ? 1 : 0}
                max={100}
                step={1}
                value={Math.round((region?.[key] ?? 0) * 100)}
                onChange={(e) => number(key, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
        <label className="field">
          <span>What should change in this area?</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="For example: make Ava’s face match her approved reference; keep her expression and hair."
          />
        </label>
      </fieldset>
      {sampleMode && (
        <p className="help">
          Sample mode demonstrates a local color patch. It does not interpret
          feedback or repair a face. Choose AI mode for real edits.
        </p>
      )}
      <button
        className="primary wide"
        disabled={
          disabled || !feedback.trim() || !region || !validRegion(region)
        }
        onClick={() => {
          if (region) void onApply(feedback.trim(), region);
        }}
      >
        Apply feedback to selected area
      </button>
      <p className="help">
        Your original stays in Versions. AI edits use API credits. You may see
        an edge around the repaired area; adjust the selection if needed.
      </p>
    </div>
  );
}
