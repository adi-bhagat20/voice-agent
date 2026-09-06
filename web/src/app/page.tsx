"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type FormState = "idle" | "submitting" | "success" | "error";

export default function HomePage() {
  const router = useRouter();

  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [roomName, setRoomName] = useState("");

  const nameRef    = useRef<HTMLInputElement>(null);
  const phoneRef   = useRef<HTMLInputElement>(null);
  const contextRef = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const name    = nameRef.current?.value.trim() ?? "";
    const phone   = phoneRef.current?.value.trim() ?? "";
    const context = contextRef.current?.value.trim() ?? "";

    // Client-side validation
    if (!name) {
      setErrorMsg("Please enter your name.");
      nameRef.current?.focus();
      return;
    }
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      setErrorMsg("Enter your phone in E.164 format, e.g. +919876543210");
      phoneRef.current?.focus();
      return;
    }

    setFormState("submitting");

    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, context }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setRoomName(data.roomName);
      setFormState("success");

      // Navigate to the call-status page after a short delay
      setTimeout(() => {
        router.push(`/call-status/${encodeURIComponent(data.roomName)}`);
      }, 2000);
    } catch (err) {
      setFormState("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const isSubmitting = formState === "submitting";
  const isSuccess    = formState === "success";

  return (
    <main className={styles.main}>
      {/* Background gradient blobs */}
      <div className={styles.blob1} aria-hidden="true" />
      <div className={styles.blob2} aria-hidden="true" />

      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.badge}>🎙️ Live AI Demo</div>
          <h1 className={styles.title}>
            Talk to <span className={styles.highlight}>Aria</span>
          </h1>
          <p className={styles.subtitle}>
            Acuron AI's voice agent will call you back within&nbsp;
            <strong>10 seconds</strong>. Powered by Deepgram&nbsp;STT,
            Groq LLM, and Sarvam TTS.
          </p>
        </header>

        {/* Card */}
        <div className={styles.card}>
          {isSuccess ? (
            <SuccessState roomName={roomName} />
          ) : (
            <form
              id="call-form"
              className={styles.form}
              onSubmit={handleSubmit}
              noValidate
            >
              <div className={styles.field}>
                <label htmlFor="caller-name" className={styles.label}>
                  Your Name
                </label>
                <input
                  id="caller-name"
                  ref={nameRef}
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Rohan Mehra"
                  autoComplete="name"
                  disabled={isSubmitting}
                  maxLength={80}
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="caller-phone" className={styles.label}>
                  Phone Number
                  <span className={styles.hint}>(E.164 format)</span>
                </label>
                <input
                  id="caller-phone"
                  ref={phoneRef}
                  type="tel"
                  className={styles.input}
                  placeholder="+919876543210"
                  autoComplete="tel"
                  disabled={isSubmitting}
                  maxLength={16}
                  required
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="caller-context" className={styles.label}>
                  Context&nbsp;<span className={styles.optional}>(optional)</span>
                </label>
                <textarea
                  id="caller-context"
                  ref={contextRef}
                  className={styles.textarea}
                  placeholder="Anything you'd like Aria to know before the call…"
                  rows={3}
                  disabled={isSubmitting}
                  maxLength={500}
                />
              </div>

              {/* Error message */}
              {formState === "error" && (
                <div id="form-error" role="alert" className={styles.error}>
                  ⚠️ {errorMsg}
                </div>
              )}

              <button
                id="call-submit-btn"
                type="submit"
                className={styles.button}
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <span className={styles.buttonContent}>
                    <span className={styles.spinner} aria-hidden="true" />
                    Initiating call…
                  </span>
                ) : (
                  <span className={styles.buttonContent}>
                    📞&nbsp; Call Me Now
                  </span>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Tech stack footer */}
        <footer className={styles.footer}>
          <p className={styles.footerText}>
            Built with&nbsp;
            <a href="https://livekit.io" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>LiveKit</a>&nbsp;·&nbsp;
            <a href="https://deepgram.com" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Deepgram</a>&nbsp;·&nbsp;
            <a href="https://groq.com" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Groq</a>&nbsp;·&nbsp;
            <a href="https://sarvam.ai" target="_blank" rel="noopener noreferrer" className={styles.footerLink}>Sarvam AI</a>
          </p>
        </footer>
      </div>
    </main>
  );
}

function SuccessState({ roomName }: { roomName: string }) {
  return (
    <div className={styles.successState} role="status" aria-live="polite">
      <div className={styles.successIcon}>📞</div>
      <h2 className={styles.successTitle}>Calling you now!</h2>
      <p className={styles.successBody}>
        Aria is dialling your phone. Pick up within the next few seconds.
        Redirecting to the status page…
      </p>
      <p className={styles.successRoom}>Room: {roomName}</p>
    </div>
  );
}
