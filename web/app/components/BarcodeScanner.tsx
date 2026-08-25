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
    <div className="border border-border bg-surface p-4">
      <p className="mb-1 text-sm font-bold text-ink">Scan a barcode</p>
      <p className="mb-3 text-xs text-ink-dim">
        Point the camera at the package, or type the number underneath it.
      </p>

      {scanning && (
        <div className="mb-3">
          <video ref={video} playsInline muted className="w-full border border-border" />
          <button
            type="button"
            onClick={stop}
            className="mt-2 border border-border px-3.5 py-2 text-sm font-bold text-ink"
          >
            Stop scanning
          </button>
        </div>
      )}

      {!scanning && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="mb-2 w-full border border-dashed border-border px-3.5 py-2.5 text-sm font-bold text-ink-dim disabled:opacity-40"
        >
          Open camera
        </button>
      )}

      <div className="flex gap-2">
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
          placeholder="e.g. 5449000000996"
          className="flex-1 border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          disabled={busy || !typed.trim()}
          onClick={submitTyped}
          className="border border-accent bg-accent px-3.5 py-2 text-sm font-bold text-[#1a1006] disabled:opacity-40"
        >
          {busy ? "..." : "Look up"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-warn">{error}</p>}
    </div>
  );
}
