"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { MicIcon } from "../components/icons";
import { Notice, haptic } from "../components/ui";

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
        haptic([10, 40, 10]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't transcribe that");
      } finally {
        setWorking(false);
      }
    };

    recorder.current = rec;
    rec.start();
    setRecording(true);
    haptic();
  }

  function stop() {
    recorder.current?.stop();
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        disabled={disabled || working}
        onClick={recording ? stop : start}
        aria-label={recording ? "Stop recording" : "Say what you ate"}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40 ${
          recording
            ? "bg-warn text-white"
            : "bg-linear-to-br from-accent to-accent-2 text-on-accent shadow-pop"
        }`}
      >
        {/* The halo only exists while recording -- it is the one unambiguous
            signal that the microphone is live. */}
        {recording && (
          <span aria-hidden className="pulse absolute inset-0 rounded-full bg-warn/40" />
        )}
        <MicIcon className="relative h-8 w-8" />
      </button>

      <p className="mt-3 text-center text-[0.8rem] font-bold text-ink">
        {working ? "Transcribing…" : recording ? "Listening — tap to stop" : "Say what you ate"}
      </p>
      <p className="mt-0.5 text-center text-[0.72rem] text-ink-dim">
        You&apos;ll read it back before anything is logged.
      </p>

      {error && (
        <div className="mt-3 w-full">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
    </div>
  );
}
