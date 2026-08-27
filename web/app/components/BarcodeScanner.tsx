"use client";

import { useEffect, useRef, useState } from "react";

// The browser's own BarcodeDetector exists on Android Chrome and nowhere else
// that matters -- not desktop Chromium, not Safari. This polyfill implements
// the same standard API on top of ZXing compiled to WebAssembly, so the code
// below is unchanged and scanning now works everywhere.
//
// Chosen over calling a scanning library directly precisely because it needs
// no rewrite: if browsers ever ship the real thing widely, deleting this
// import is the whole migration.
import { BarcodeDetector } from "barcode-detector/ponyfill";
import { BarcodeIcon, CameraIcon } from "./icons";
import { Notice, haptic } from "./ui";

// Retail food formats only. Narrowing what it looks for makes each frame
// cheaper and stops a QR code on the packaging being read as the product.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
const POLL_MS = 400;

export default function BarcodeScanner({
  onDetected,
  busy,
}: {
  onDetected: (code: string) => void;
  busy?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setScanning(false);
  };

  // Releasing the camera matters: left running, the browser keeps showing a
  // recording indicator and the phone keeps burning battery.
  useEffect(() => stop, []);

  async function start() {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
    } catch {
      setError("Camera access was blocked — type the number instead.");
      return;
    }

    setScanning(true);
    if (video.current) {
      video.current.srcObject = stream.current;
      await video.current.play().catch(() => {});
    }

    const detector = new BarcodeDetector({ formats: [...FORMATS] });
    const tick = async () => {
      if (!stream.current || !video.current) return;
      try {
        const found = await detector.detect(video.current);
        if (found.length > 0) {
          stop();
          haptic([12, 40, 12]);
          onDetected(found[0].rawValue);
          return;
        }
      } catch {
        // A frame that can't be read is normal; keep looking.
      }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  }

  /** Dispatch a typed code exactly once.
   *
   * The field is cleared first: leaving the code in place meant Enter and then
   * the button -- or one impatient double-click -- added the same product
   * twice, silently doubling the calories with nothing on screen to explain it.
   */
  function submitTyped() {
    const code = typed.trim();
    if (!code) return;
    setTyped("");
    onDetected(code);
  }

  return (
    <div>
      {scanning ? (
        <div className="rise relative overflow-hidden rounded-2xl border border-border bg-black">
          <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
          {/* A reticle turns "point your phone somewhere" into "put the barcode
              in this box", which is the difference between scanning in two
              seconds and giving up. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-56 rounded-xl border-2 border-accent/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
          <button
            type="button"
            onClick={stop}
            className="btn btn-ghost absolute right-3 bottom-3 min-h-0 px-4 py-2 text-[0.8rem]"
          >
            Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2 px-6 py-10 text-center transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-2 text-on-accent">
            <BarcodeIcon className="h-7 w-7" />
          </span>
          <b className="text-[0.95rem] font-extrabold text-ink">Scan the barcode</b>
          <span className="max-w-[16rem] text-[0.78rem] text-ink-dim">
            Packaged food gets exact numbers straight off the label.
          </span>
        </button>
      )}

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[0.72rem] font-bold text-ink-dim">or type it</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitTyped();
            }
          }}
          inputMode="numeric"
          aria-label="Barcode number"
          placeholder="5449000000996"
          className="field flex-1 py-2.5 text-sm tabular-nums"
        />
        <button
          type="button"
          disabled={busy || !typed.trim()}
          onClick={submitTyped}
          className="btn btn-ghost min-h-0 shrink-0 px-4 py-2.5 text-[0.8rem]"
        >
          {busy ? "…" : "Look up"}
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      {!scanning && !error && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-ink-dim">
          <CameraIcon className="h-3.5 w-3.5" />
          Works in any browser — no app store detour.
        </p>
      )}
    </div>
  );
}
