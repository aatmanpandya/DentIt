"use client";

import { useRef, useState } from "react";

/**
 * Informal consent capture, not a legal e-signature — see docs/specs/treatment-planning.md's
 * "Signature capture" section. Draws to a canvas and exports a base64 PNG data URI, which
 * `acceptTreatmentPlan` sends as-is; there's no object-storage backend in this codebase yet
 * (see the spec), so the image is stored directly rather than uploaded anywhere.
 */
export function SignaturePad({ onChange }: { onChange: (dataUri: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c1917";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    onChange(canvas ? canvas.toDataURL("image/png") : null);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <canvas
        ref={canvasRef}
        width={360}
        height={120}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="cursor-crosshair touch-none rounded-[var(--radius)] border border-rule bg-paper"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-soft">Patient signs here to confirm acceptance.</span>
        {hasStroke && (
          <button type="button" onClick={clear} className="text-[11px] text-ink-soft underline hover:text-ink">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
