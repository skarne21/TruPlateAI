"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Native barcode detection. Present on Android Chrome -- the phone-in-a-kitchen
// case this is for -- and absent on desktop Chromium and Safari, so typing the
// number stays a first-class path rather than a consolation prize.
type DetectedBarcode = { rawValue: string };
type DetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): DetectorLike;
      getSupportedFormats(): Promise<string[]>;
    };
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
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

  // Whether the browser can detect barcodes is a fact about the environment,
  // not state. Reading it during render would break server rendering (there is
  // no `window`), and setting it from an effect costs a second render -- so it
  // is read through useSyncExternalStore, which has a server answer built in.
  // The subscribe function is a no-op because the capability never changes.
  const canScan = useSyncExternalStore(
    () => () => {},
    () => "BarcodeDetector" in window,
    () => false,
  );

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
    if (!window.BarcodeDetector) return;

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

    const detector = new window.BarcodeDetector({ formats: FORMATS });
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

  return (
    <div className="border border-border bg-surface p-4">
      <p className="mb-1 text-sm font-bold text-ink">Scan a barcode</p>
      <p className="mb-3 text-xs text-ink-dim">
        {canScan
          ? "Point the camera at the package, or type the number under it."
          : "This browser can't use the camera for barcodes — type the number under the barcode."}
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

      {canScan && !scanning && (
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
              if (typed.trim()) onDetected(typed.trim());
            }
          }}
          inputMode="numeric"
          placeholder="e.g. 5449000000996"
          className="flex-1 border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          disabled={busy || !typed.trim()}
          onClick={() => onDetected(typed.trim())}
          className="border border-accent bg-accent px-3.5 py-2 text-sm font-bold text-[#1a1006] disabled:opacity-40"
        >
          {busy ? "..." : "Look up"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-warn">{error}</p>}
    </div>
  );
}
