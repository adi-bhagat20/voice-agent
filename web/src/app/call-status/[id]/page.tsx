"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./status.module.css";

type CallStatus = "connecting" | "ringing" | "active" | "ended" | "error";

interface StatusState {
  status: CallStatus;
  message: string;
  detail?: string;
  duration: number;      // seconds since active
}

const STATUS_MESSAGES: Record<CallStatus, string> = {
  connecting: "Connecting to Aria…",
  ringing:    "Ringing your phone…",
  active:     "Call in progress",
  ended:      "Call ended",
  error:      "Something went wrong",
};

export default function CallStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roomName = decodeURIComponent(params.id ?? "");

  const [state, setState] = useState<StatusState>({
    status: "connecting",
    message: STATUS_MESSAGES.connecting,
    duration: 0,
  });

  // Poll the status API every 3 seconds
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/call-status?room=${encodeURIComponent(roomName)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        status: CallStatus;
        detail?: string;
      };
      setState((prev) => ({
        ...prev,
        status: data.status,
        message: STATUS_MESSAGES[data.status] ?? data.status,
        detail: data.detail,
      }));
    } catch {
      // Don't crash on poll errors — just keep trying
    }
  }, [roomName]);

  // Duration counter while call is active
  useEffect(() => {
    if (state.status !== "active") return;
    const id = setInterval(() => {
      setState((prev) => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.status]);

  // Start polling
  useEffect(() => {
    if (!roomName) return;
    // Immediate first poll after 2s (SIP takes a moment)
    const initial = setTimeout(pollStatus, 2000);
    const interval = setInterval(pollStatus, 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [roomName, pollStatus]);

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  return (
    <main className={styles.main}>
      <div className={styles.blob1} aria-hidden="true" />
      <div className={styles.blob2} aria-hidden="true" />

      <div className={styles.container}>
        <div className={styles.card}>
          {/* Icon */}
          <div
            className={`${styles.icon} ${styles[state.status]}`}
            aria-hidden="true"
          >
            {state.status === "connecting" && <ConnectingIcon />}
            {state.status === "ringing"    && "📞"}
            {state.status === "active"     && <WaveIcon />}
            {state.status === "ended"      && "✓"}
            {state.status === "error"      && "⚠️"}
          </div>

          {/* Status text */}
          <h1 className={styles.title} aria-live="polite">
            {state.message}
          </h1>

          {state.detail && (
            <p className={styles.detail}>{state.detail}</p>
          )}

          {/* Duration counter */}
          {state.status === "active" && (
            <p className={styles.duration} aria-live="polite">
              {formatDuration(state.duration)}
            </p>
          )}

          {/* Room info */}
          <p className={styles.roomName}>Room: {roomName}</p>

          {/* Status indicator bar */}
          <div className={styles.steps}>
            {(["connecting", "ringing", "active", "ended"] as CallStatus[]).map(
              (s) => (
                <div
                  key={s}
                  className={`${styles.step} ${
                    getStepIndex(state.status) >= getStepIndex(s)
                      ? styles.stepDone
                      : styles.stepPending
                  }`}
                  aria-label={s}
                >
                  <span className={styles.stepDot} />
                  <span className={styles.stepLabel}>{s}</span>
                </div>
              )
            )}
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            {(state.status === "ended" || state.status === "error") && (
              <button
                id="call-again-btn"
                className={styles.btnPrimary}
                onClick={() => router.push("/")}
              >
                Call Again
              </button>
            )}
            <button
              id="go-home-btn"
              className={styles.btnSecondary}
              onClick={() => router.push("/")}
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function getStepIndex(status: CallStatus): number {
  return ["connecting", "ringing", "active", "ended"].indexOf(status);
}

function ConnectingIcon() {
  return (
    <svg
      className={styles.spinSvg}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <div className={styles.waveWrapper} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={styles.wavebar}
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}
