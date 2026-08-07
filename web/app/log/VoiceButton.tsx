"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

// First format the browser supports. Chrome records webm, Firefox ogg, Safari
// mp4 -- Gemini accepts all three, so nothing needs converting client-side.
const PREFERRED_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Record a spoken meal description and drop the cleaned text into the caption.
 *
 * The transcript is never submitted for you -- it fills the editable caption so
 * a misheard food gets caught by a human before it becomes calories.
 */
export default function VoiceButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  async function start() {
    setError(null);
    const mimeType = pickMimeType();
    if (!mimeType) {
      setError("Recording isn't supported in this browser — type instead.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked — type instead.");
      return;
    }

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

    rec.onstop = async () => {
      // Release the mic promptly; leaving it open keeps the browser's
      // recording indicator on and looks like the app is still listening.
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setWorking(true);
      try {
        const form = new FormData();
        form.append("audio", new Blob(chunks, { type: mimeType }), "meal.webm");
        const res = await apiFetch("/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          // The backend explains *why* (service busy, usage limit, bad audio).
          // Discarding that for a generic message throws away the useful part.
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.detail || "Couldn't transcribe that — try again or type it.");
        }
        const { text } = await res.json();
        if (!text.trim()) {
          setError("Didn't catch any food in that — try again or type it.");
          return;
        }
        onTranscript(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't transcribe that");
      } finally {
        setWorking(false);
      }
    };

    recorder.current = rec;
    rec.start();
    setRecording(true);
  }

  function stop() {
    recorder.current?.stop();
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled || working}
        onClick={recording ? stop : start}
        className={`w-full border px-3.5 py-2.5 text-sm font-bold disabled:opacity-40 ${
          recording
            ? "border-warn bg-warn/10 text-ink"
            : "border-dashed border-border text-ink-dim"
        }`}
      >
        {working ? "Transcribing..." : recording ? "Stop recording" : "Say what you ate"}
      </button>
      {recording && (
        <p className="mt-1.5 text-xs text-ink-dim">
          Listening — you&apos;ll get a chance to edit before anything is logged.
        </p>
      )}
      {error && <p className="mt-1.5 text-xs font-semibold text-warn">{error}</p>}
    </div>
  );
}
