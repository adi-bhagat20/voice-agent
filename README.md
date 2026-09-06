# "Call Me" — AI Voice Agent Demo

> **Live demo for Acuron AI.** A visitor fills a short web form → an AI voice agent calls their phone → short spoken conversation → hangs up.

---

## How it works

```
Browser form (Vercel)
  └─ POST /api/call
        └─ Creates LiveKit room + dispatches agent + creates SIP participant
              └─ LiveKit → dispatches Python worker (Railway/Render)
                    └─ Python worker: Deepgram STT → Groq LLM → Sarvam TTS
                          └─ LiveKit SIP bridge → Vobiz → caller's phone
```

Two services, always running. The web service only kicks things off; the actual voice conversation lives in the Python worker.

---

## Accounts you need to create (once)

| Service | What for | Free tier enough? |
|---|---|---|
| [LiveKit Cloud](https://cloud.livekit.io) | Real-time media + SIP bridge | Yes (dev tier) |
| [Vobiz](https://vobiz.in) | SIP trunk for India outbound calls | Requires top-up (~₹100) |
| [Deepgram](https://deepgram.com) | Speech-to-text | Yes ($200 free credit) |
| [Groq](https://console.groq.com) | LLM inference | Yes (free tier) |
| [Sarvam AI](https://app.sarvam.ai) | Indian-language TTS | Yes (free tier) |
| [Vercel](https://vercel.com) | Host the Next.js web app | Yes (Hobby) |
| [Railway](https://railway.app) | Host the Python agent | Yes ($5 credit) |

---

## Setup — Step by Step

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd voice-agent-demo
```

### 2. Set up the LiveKit outbound SIP trunk (Vobiz)

This is done once via the LiveKit CLI or dashboard — the trunk ID is stored server-side.

```bash
# Install the LiveKit CLI
npm install -g @livekit/livekit-cli

# Log in
lk cloud auth

# Create an outbound trunk (replace values with your Vobiz SIP credentials)
lk sip outbound create \
  --name "vobiz-india" \
  --address "<vobiz-sip-host>" \
  --username "<vobiz-username>" \
  --password "<vobiz-password>" \
  --numbers "+91XXXXXXXXXX"   # Your Vobiz caller-ID number
```

Copy the returned **Trunk ID** — you'll paste it into `web/.env.local` below.

### 3. Configure the Python agent (`agent/`)

```bash
cd agent
cp .env.example .env
```

Edit `agent/.env` and fill in:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SARVAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Install dependencies:

```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 4. Run the agent in console mode (local sanity check — no phone call)

```bash
python agent.py console
```

You should see the agent start, connect to LiveKit, and in the console you can type messages to test the conversation. Verify you see:
- `STT RESULT:` lines (input)
- `LLM reply` output
- TTS audio in the console player

### 5. Configure the web app (`web/`)

```bash
cd ../web
cp .env.example .env.local
```

Edit `web/.env.local`:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SIP_OUTBOUND_TRUNK_ID=ST_xxxxxxxxxxxxxxxx
```

Install and run:

```bash
npm install
npm run dev
```

Open http://localhost:3000 — you should see the form.

### 6. Deploy the agent (Railway)

1. Push your repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** → select your repo → set the root directory to `agent/`.
3. Add the environment variables from `agent/.env` in the Railway dashboard.
4. Deploy. Check logs — you should see `Worker registered with LiveKit`.

### 7. Deploy the web app (Vercel)

1. In Vercel: **Import Project → GitHub** → select your repo → set root directory to `web/`.
2. Add the environment variables from `web/.env.local` in the Vercel dashboard.
3. Deploy.

### 8. End-to-end test

1. Open your Vercel URL.
2. Fill in your own name and phone number.
3. Submit — your phone should ring within ~10 seconds.
4. Have a short conversation and hang up.
5. Verify no errors in Railway logs.

---

## Customising the agent

Edit **`agent/persona.py`** only. It contains:
- `AGENT_NAME` — what the agent calls itself
- `BUSINESS_NAME` — the company name
- `SYSTEM_PROMPT` — the conversation instructions
- `GREETING_WITH_NAME` / `GREETING_GENERIC` — opening lines
- `GOODBYE_PHRASES` — words that trigger a graceful hang-up
- `MAX_CALL_DURATION_SECONDS` — hard timeout (default 3 minutes)

No other file needs to change for a different persona.

---

## Architecture notes

- **Vercel timeout**: The `/api/call` route only creates a room + dispatches + creates a SIP participant — it returns in <2 seconds, well under Vercel's 10s limit. The actual call runs in Railway.
- **Named agent dispatch**: The web trigger dispatches to `voice-receptionist` by name. The Python worker must be running and registered with that name for dispatch to succeed.
- **Vobiz credentials**: These live inside the LiveKit outbound trunk config — never in code or env vars.
- **One call at a time**: This is a demo. There's no queue, no concurrency handling.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Phone doesn't ring | Railway logs — is the worker running? LiveKit dashboard — did the room get created? Is the trunk ID correct? |
| Agent joins but is silent | Deepgram key valid? Sarvam key valid? Check Railway logs for TTS errors. |
| "Bad phone format" error | Number must be `+91XXXXXXXXXX` (E.164 format with country code). |
| Vercel API route times out | Shouldn't happen — if it does, check LiveKit API key/secret. |
| Call drops immediately | Check Vobiz SIP trunk config — the SIP server address and credentials. |

---

## Recording the demo (fallback plan)

Before the interview, record a full end-to-end screen capture:
- Form submission
- Phone ringing
- Conversation
- Clean hang-up

If anything fails live (carrier hiccup, cold-started dyno, wifi), the recording saves the demo.

---

## Project structure

```
voice-agent-demo/
├── README.md
├── web/                    # Next.js → Vercel
│   ├── .env.example
│   ├── package.json
│   ├── app/
│   │   ├── page.tsx                        # Call form
│   │   ├── call-status/[id]/page.tsx       # Polling status view
│   │   └── api/call/route.ts               # Call trigger API
│   └── lib/
│       └── livekit-server.ts               # LiveKit server SDK wrapper
├── agent/                  # Python worker → Railway/Render
│   ├── .env.example
│   ├── requirements.txt
│   ├── agent.py            # Main entrypoint
│   ├── persona.py          # ← Edit this to change the agent persona
│   └── Procfile
└── docs/
    └── DEMO_SCRIPT.md      # Step-by-step demo instructions
```
