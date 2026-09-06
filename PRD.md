# PRD — "Call Me" AI Voice Agent Demo

## 1. What this is

A live demo built for a job interview at Acuron AI. A visitor fills a short web form (name, phone number, optional context). On submit, an AI voice agent immediately calls that phone number, has a short spoken conversation, and hangs up. The interviewer should be able to fill the form themselves and receive a real call within seconds.

This is a **demo**, not a production product. Scope is deliberately narrow: one call at a time, one persona, no dashboard, no user accounts, no data persistence beyond what's needed to place the call and show its status on screen.

## 2. Non-negotiable constraints

- **Two-service architecture. Do not try to run the voice agent on Vercel.** Vercel serverless functions on the Hobby plan hard-timeout at 10 seconds. The agent needs a long-lived process that stays connected to LiveKit for the duration of a call (often 1–3 minutes). So:
  - **Service A — `web/`**: Next.js app, deployed to Vercel. Renders the form and a call-status view. Its API route only *triggers* a call (a single fast HTTP request to LiveKit's server API) and returns — it does not participate in the call itself.
  - **Service B — `agent/`**: Python LiveKit agent worker, deployed as a long-running process on Railway or Render (not Vercel). It registers with LiveKit and handles the actual STT→LLM→TTS conversation when dispatched.
- **Plug-and-play for the human operator.** Once both services are deployed, the *only* manual step should be filling in API keys in two `.env` files (`web/.env.local` and `agent/.env`). No code edits, no manual dashboard clicking beyond initial account/API-key creation, no hardcoded phone numbers or names.
- **APIs move fast — verify, don't assume.** LiveKit's Agents framework has changed its entrypoint pattern multiple times in the last year (older `WorkerOptions`/`VoicePipelineAgent` examples are now outdated next to the current `AgentServer` + `AgentSession` pattern). Before writing any LiveKit integration code, fetch and read the current docs at docs.livekit.io rather than relying on training data or older blog posts/tutorials. Same applies to Sarvam, Deepgram, and Groq — check their current docs/PyPI pages for the latest plugin versions and method signatures.
- **Use official LiveKit plugins, not hand-rolled HTTP calls**, wherever one exists:
  - `livekit-plugins-sarvam` — official plugin covering Sarvam STT (Saaras models) and TTS (Bulbul models). Install via the `sarvam` extra: `pip install "livekit-agents[sarvam,silero]"`.
  - Groq LLM via the official plugin: `pip install "livekit-agents[groq]"`, `from livekit.plugins import groq`.
  - This avoids maintaining raw REST clients for either service and tracks upstream fixes automatically.

## 3. Architecture

```
┌─────────────────┐        POST /api/call        ┌──────────────────────┐
│   web (Vercel)   │ ────────────────────────────▶ │  LiveKit Cloud        │
│  Next.js form +  │                                │  (rooms, dispatch,    │
│  status page     │◀──── call status (polling  ───│   SIP bridge)         │
└─────────────────┘        or webhook)             └──────────┬───────────┘
                                                                │ dispatches job
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │  agent (Railway/     │
                                                     │  Render, always-on)  │
                                                     │  Python worker:      │
                                                     │  Deepgram STT (or    │
                                                     │  Sarvam STT) →       │
                                                     │  Groq LLM →          │
                                                     │  Sarvam TTS          │
                                                     └──────────┬───────────┘
                                                                │ SIP
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │  Vobiz (telephony)   │
                                                     │  → interviewer's     │
                                                     │    phone             │
                                                     └──────────────────────┘
```

The `web` service never talks to Vobiz, Deepgram, Groq, or Sarvam directly — it only talks to LiveKit to kick off a room + dispatch + SIP participant. All conversation logic and provider calls live in `agent`.

## 4. Project structure

```
voice-agent-demo/
├── README.md                     # setup steps, in plain "do this, then this" order
├── web/                          # Next.js app → deployed on Vercel
│   ├── .env.example
│   ├── package.json
│   ├── app/
│   │   ├── page.tsx               # the form
│   │   ├── call-status/[id]/page.tsx   # simple polling status view
│   │   └── api/
│   │       └── call/route.ts      # triggers LiveKit dispatch + SIP participant
│   └── lib/
│       └── livekit-server.ts      # thin wrapper around LiveKit server SDK
├── agent/                        # Python LiveKit agent worker → Railway/Render
│   ├── .env.example
│   ├── requirements.txt
│   ├── agent.py                   # entrypoint, AgentSession wiring
│   ├── persona.py                 # system prompt / greeting / business context
│   └── Procfile                   # or render.yaml — start command for the host
└── docs/
    └── DEMO_SCRIPT.md             # exact steps to run the live demo + fallback plan
```

Keep `persona.py` as the *only* file someone edits to change what the agent says about itself/the fictional business — mirrors the `config.py` pattern from the original tutorial, so it's a familiar, obviously-editable single source of truth.

## 5. Functional requirements

### Form (`web/app/page.tsx`)
- Fields: Name (text, required), Phone number (tel, required, validate E.164-ish format for India, i.e. `+91XXXXXXXXXX`), optional short "what would you like to ask?" free-text field to seed context for the agent.
- On submit: POST to `/api/call`, show a loading state, then redirect to `/call-status/[id]`.
- Basic client-side validation with a clear error message on bad phone format — do not silently fail.

### Call trigger (`web/app/api/call/route.ts`)
- Accepts name, phone number, optional context.
- Creates a LiveKit room (unique name per call, e.g. `demo-<timestamp>`).
- Dispatches the agent to that room using explicit agent dispatch (named agent, not automatic dispatch — this is LiveKit's recommended pattern specifically for telephony).
- Creates a SIP participant to dial the submitted phone number via the configured Vobiz outbound trunk, passing name/context through as room metadata or participant attributes so the agent can personalize the greeting ("Hi, is this Rohan?").
- Returns a call ID / room name immediately; must complete well under Vercel's timeout (this is a single outbound API call, should take well under 2 seconds).
- On any failure (bad number, LiveKit error, trunk error), return a clear error to the frontend — don't let it hang.

### Agent (`agent/agent.py`)
- Waits for explicit dispatch (named agent) rather than auto-joining every room.
- Reads name/context from room/participant metadata if present; falls back to a generic greeting if not.
- STT: Deepgram (primary, already proven in the existing local setup) — Sarvam STT is an acceptable swap if Deepgram gives trouble, since the official plugin exists.
- LLM: Groq (fast, cheap, already proven). Keep the system prompt in `persona.py`, short and scoped — this is a scripted-feeling receptionist demo, not an open-ended assistant, and a narrow scope reduces the chance of it saying something odd live.
- TTS: Sarvam (Bulbul model) via the official `livekit-plugins-sarvam` plugin.
- Should end the call gracefully after a reasonable exchange (either on explicit "goodbye"-type intent or a hard cap, e.g. 2–3 minutes) rather than running indefinitely.
- Log every stage (call started, STT result, LLM response, TTS started, call ended, any provider error) to stdout — Railway/Render both surface stdout logs live, which is your only debugging tool during the actual interview if something misbehaves.

## 6. Environment variables

`web/.env.example`
```
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
SIP_OUTBOUND_TRUNK_ID=
```

`agent/.env.example`
```
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DEEPGRAM_API_KEY=
GROQ_API_KEY=
SARVAM_API_KEY=
```

(Vobiz credentials live inside the LiveKit outbound trunk config, created once via the LiveKit CLI/dashboard per the setup README — not duplicated as raw env vars in either service, since LiveKit stores the trunk server-side.)

## 7. Non-functional requirements

- **Single command to run each service locally**: `npm run dev` for `web`, `python agent.py dev` (or `console` for a no-telephony local test) for `agent`.
- **No secrets in code.** Everything provider-related comes from env vars, loaded via `.env.local` (web) / `.env` (agent) — never hardcoded, never committed.
- **Fail loud, not silent.** Any provider error (bad API key, trunk failure, timeout) should surface as a visible error on the status page and in the agent's logs — a silently-stuck "calling..." spinner is worse than an honest error during a live demo.
- **README written for someone who has never seen this repo before**: exact order of account creation, exact env vars to paste where, exact deploy commands. Assume the reader (future-you, at 11pm) is tired and in a hurry.

## 8. Explicitly out of scope

- Multi-language support, dashboards, call history/persistence, multi-tenant config, billing — none of this matters for a single live demo and each one is a place for something to break tonight.
- Any bulk or repeated outbound calling. This project only ever places **one call at a time, to a number the person just typed in themselves** — it is a live opt-in demo, not an outbound campaign, so it does not need DLT/TRAI commercial-outbound registration. Do not extend this into automated/bulk calling without separately checking that compliance question first.

## 9. Acceptance criteria

1. Visiting the deployed Vercel URL shows a working form.
2. Submitting a real phone number results in that phone actually ringing within ~10 seconds, with the agent speaking first.
3. A short back-and-forth exchange works (agent understands a spoken response and replies sensibly).
4. The call ends cleanly (either side hanging up doesn't crash the agent process).
5. The whole flow has been tested end-to-end at least twice, on two different real phones, before it's shown to anyone else.

## 10. Fallback plan (read this even if everything works)

Record a clean screen capture of one full successful run (form submission → phone ringing → conversation → hang-up) before the interview. Live demos fail for reasons that have nothing to do with your code — a carrier hiccup, a cold-started free-tier dyno, a flaky wifi. Having the recording ready means a live failure costs you nothing.
