# DEMO_SCRIPT.md

> **Read this before the interview.** Even if everything works perfectly, knowing this by heart means nothing surprises you.

---

## Pre-demo checklist (do this 30 minutes before)

- [ ] Railway logs are live and show `Worker registered with LiveKit`
- [ ] Vercel URL loads the form without errors
- [ ] You've done at least one successful test call in the last hour
- [ ] Screen recording is ready (fallback — see below)
- [ ] Your phone is charged and not on DND/silent
- [ ] Browser tab with Railway logs is open in a separate window

---

## Live demo script — step by step

### Step 1: Open the form (30 seconds)

Navigate to the Vercel URL. Briefly explain what the interviewer is looking at:

> "This is the entry point — a simple web form. The visitor types in their name, phone number, and an optional message. When they hit Submit, an AI voice agent calls them within about 10 seconds."

### Step 2: Fill in the form and submit

Enter:
- **Name**: The interviewer's name (or yours if they prefer to watch)
- **Phone**: A real phone number in +91XXXXXXXXXX format
- **Context** (optional): "Curious about the Sarvam TTS voice"

Click **Submit**. The page will redirect to the status view.

> "The API route just created a LiveKit room, dispatched the Python agent, and asked LiveKit's SIP bridge to dial the number via Vobiz. The whole thing took under two seconds — you can see the status is already 'Connecting'."

### Step 3: Answer the phone

The phone will ring in ~5–15 seconds (SIP setup + TTS warmup).

Answer it and let the agent speak first. The agent will say something like:

> "Hi, is this [Name]? I'm Aria, an AI voice assistant from Acuron AI. I'm calling because you requested a live demo. How are you doing today?"

Respond naturally. The agent will:
1. Acknowledge your response
2. Ask if you'd like to know more about the tech or see the demo
3. Answer 1–2 follow-up questions briefly
4. Wrap up after 1–3 exchanges

### Step 4: Hang up (or let the agent wrap up)

Either hang up naturally or say "Thanks, goodbye" — the agent will detect the goodbye phrase and wrap up gracefully.

### Step 5: Show the status page

After the call ends, point to the status page:

> "The status page updated to 'Ended'. In a production version, you'd store call metadata and show a summary — but for this demo, it's intentionally minimal."

---

## Talking points while the call is in progress

If the interviewer wants to talk tech while the call is happening:

- **LiveKit** handles the WebRTC ↔ SIP bridging. The Python worker connects to the same LiveKit room as the phone call.
- **Deepgram STT** transcribes the caller's speech in real time (~300ms latency).
- **Groq** runs the LLM — chosen for speed (<1s on Llama 3.3 70B).
- **Sarvam TTS** converts the reply to speech using an Indian-English voice (Bulbul model).
- The web service runs on Vercel serverless, but the voice agent runs as a long-lived process on Railway — that's a hard architectural requirement (Vercel serverless times out at 10s).

---

## Fallback plan (if anything goes wrong live)

> **Never let a live demo failure be a surprise.**

### Fallback A — Phone rings but call drops immediately
This is usually a Vobiz SIP trunk issue. Switch to the recording.

### Fallback B — Agent joins but doesn't speak
Likely a Sarvam TTS key error. Check Railway logs. Switch to recording.

### Fallback C — Vercel API route errors
Check that the Railway worker is running and registered. Switch to recording.

### Fallback D — Network/carrier issue at the venue
Completely outside your control. Switch to recording without apology.

**To switch to the recording:**

> "Live demos sometimes have carrier or network hiccups that are completely outside the code — let me show you the recorded run I did earlier."

Play the screen recording. It proves the system works end-to-end and is just as compelling as a live run.

---

## Recovery phrases (things to say if something breaks)

- "The Railway free tier cold-starts — let me restart the dyno, it'll be up in 30 seconds."
- "Vobiz SIP connections can take a few seconds to negotiate — let me try again."
- "Let me switch to the recording I prepared — the live version works identically."

---

## What to record for the fallback video

1. Open the Vercel form on a clean browser (incognito, no extensions)
2. Fill in the form with a real phone number
3. Show the phone ringing (phone on screen or audible)
4. Have a full conversation with the agent
5. Let the agent wrap up and hang up
6. Show the status page updating to "Ended"

Total recording: ~90 seconds. Upload to Google Drive and have the link ready.
