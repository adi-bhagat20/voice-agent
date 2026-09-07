# 🛠️ Engineering Challenges, Post-Mortems & Future Pipeline

> **Acuron AI Voice Agent Engineering Journal**  
> A detailed technical breakdown of real-world bugs, platform constraints, and architecture hurdles encountered during development and cloud deployment, along with their solutions and the roadmap for unresolved items.

---

## 📌 Table of Contents
1. [Overview & Context](#-overview--context)
2. [Resolved Challenges & Post-Mortems](#-resolved-challenges--post-mortems)
   - [1. Python 3.14 vs. Native C Extension Incompatibilities](#1-python-314-vs-native-c-extension-incompatibilities)
   - [2. Groq LLM Model Deprecation / 404 Not Found](#2-groq-llm-model-deprecation--404-not-found)
   - [3. Outbound SIP Trunk Configuration & E.164 Number Validation](#3-outbound-sip-trunk-configuration--e164-number-validation)
   - [4. Render Free-Tier Port Binding & HTTP Health-Checks](#4-render-free-tier-port-binding--http-health-checks)
   - [5. The 35-Second "Dead Silence" Race Condition](#5-the-35-second-dead-silence-race-condition)
   - [6. Disappearing Caller Metadata on Dispatch](#6-disappearing-caller-metadata-on-dispatch)
   - [7. The 512 MB Out-Of-Memory (OOM) Kernel Crash](#7-the-512-mb-out-of-memory-oom-kernel-crash)
3. [Unresolved Challenges & Active Pipeline](#-unresolved-challenges--active-pipeline)
   - [1. Telephony Audio Clarity & Codec Downsampling](#1-telephony-audio-clarity--codec-downsampling)
   - [2. Persistent Database & Call Transcript Storage](#2-persistent-database--call-transcript-storage)
   - [3. Cross-Call State Management & Caller Memory](#3-cross-call-state-management--caller-memory)
   - [4. Post-Call Lead Qualification & CRM Ingestion Webhooks](#4-post-call-lead-qualification--crm-ingestion-webhooks)
   - [5. Free-Tier Container Spin-Down / Cold Starts](#5-free-tier-container-spin-down--cold-starts)

---

## 📖 Overview & Context
Building an outbound telephone voice agent requires coordinating five distinct network systems in real-time:
1. **Next.js Web Frontend** (User initiates call request)
2. **LiveKit Cloud WebRTC & SIP Trunking** (Bridges telephone PSTN with real-time audio rooms)
3. **Python Worker Runtime** (Stateful orchestration on Render/Railway)
4. **AI Inference Pipeline** (Deepgram STT &rarr; Groq LLM &rarr; Sarvam TTS)
5. **Vobiz Indian PSTN Carrier** (Dials physical mobile phones over +91 telecom networks)

Because speech operates under strict real-time constraints (<500ms latency ceiling), small configuration mismatches or memory leaks immediately manifest as dropped calls, frozen workers, or robotic audio.

---

## 🔍 Resolved Challenges & Post-Mortems

### 1. Python 3.14 vs. Native C Extension Incompatibilities
* **Symptom**: During initial dependency installation, `pip install -r requirements.txt` failed with compilation errors on `livekit-blingfire` and `onnxruntime`.
* **Root Cause**: Python 3.14 was the default interpreter on the local development machine. PyPI lacked pre-compiled binary wheels for `livekit-blingfire` and C++ extensions for Python 3.14 on Windows and Linux x86_64.
* **Resolution**:
  - Pinned the project strictly to **Python 3.13** (`3.13.13`).
  - Added `.python-version` specifying `3.13` for automated cloud buildpacks.
  - Re-created virtual environment using `py -3.13 -m venv voice-env`.

---

### 2. Groq LLM Model Deprecation / 404 Not Found
* **Symptom**: The agent connected to the room but threw an unhandled exception when caller spoke: `groq.APIStatusError: 404 model_not_found`.
* **Root Cause**: The worker initially specified `llama-3.3-70b-versatile`. That model ID was either restricted or undergoing deprecation on the provisioned Groq API tier.
* **Resolution**:
  - Benchmarked available fast-inference models on the user's Groq tier.
  - Migrated LLM provider to **`openai/gpt-oss-20b`** on Groq.
  - Token generation latency dropped to **<120ms to first token**, perfectly matching the conversational pace needed for telephone calls.

---

### 3. Outbound SIP Trunk Configuration & E.164 Number Validation
* **Symptom**: Submitting form numbers like `09921347249` or `9921347249` resulted in SIP carrier rejection codes (`400 Bad Request` / `404 Not Found`).
* **Root Cause**: Telecom gateways (Vobiz / Tata / Airtel) strictly require full **E.164 international formatting** with leading plus signs (e.g. `+919921347249`). Furthermore, the Next.js API route initially crashed if `CALLER_PHONE_NUMBER` was omitted from `.env.local`.
* **Resolution**:
  - Implemented strict regex validation `^\+[1-9]\d{6,14}$` in `web/src/app/api/call/route.ts`.
  - Added auto-formatting helper and international country selector (+91 default) in UI.
  - Made `CALLER_PHONE_NUMBER` optional in `lib/livekit-server.ts`, falling back to the SIP Trunk's default outbound caller ID.

---

### 4. Render Free-Tier Port Binding & HTTP Health-Checks
* **Symptom**: Deploying to Render as a Web Service resulted in deployment failures: `Timed out waiting for port 10000 to be open`.
* **Root Cause**: Render Web Services expect an HTTP server listening on the port designated by the `$PORT` environment variable (default `10000`). LiveKit agents primarily run as persistent WebSocket background workers.
* **Resolution**:
  - Configured `cli.run_app(WorkerOptions(..., port=int(os.getenv("PORT", "8081")), host="0.0.0.0"))`.
  - LiveKit's internal health check server successfully binds to `0.0.0.0:10000`, satisfying Render's ingress router and keeping the service alive.

---

### 5. The 35-Second "Dead Silence" Race Condition
* **Symptom**: When a user received the outbound phone call and answered, they were greeted by **complete silence for 35 seconds**. Most callers hung up before hearing anything.
* **Root Cause**:
  - To prevent the agent from speaking while the phone was still ringing, we implemented `wait_for_participant_attribute(..., attribute="sip.callStatus", value="active", timeout=35.0)`.
  - Outbound SIP trunk providers don't reliably push standard WebRTC attribute changes to the agent room when the PSTN state changes to active.
  - As a result, `await wait_for_participant_attribute(...)` blocked the entire entrypoint for the full 35-second timeout before `AgentSession.start()` was ever called!
* **Resolution**:
  - Removed the blocking attribute listener.
  - Initiated `AgentSession.start()` immediately once `wait_for_participant()` resolved, accompanied by a lightweight 1.0s audio buffer delay to allow the PSTN voice channel to stabilize before firing the opening greeting.

---

### 6. Disappearing Caller Metadata on Dispatch
* **Symptom**: In worker logs, metadata was parsed as `name='' company='' use_case=''`. Aria greeted callers generically as "there" instead of using their real name and company.
* **Root Cause**:
  - In `route.ts`, metadata was provided in the `createDispatch(roomName, "voice-receptionist", { metadata })` call.
  - In LiveKit Agents, explicit dispatch metadata is attached to `ctx.job.metadata`, whereas the worker was exclusively querying `ctx.room.metadata`.
* **Resolution**:
  - Updated metadata extraction in `agent.py`:
    ```python
    meta_raw = getattr(ctx.job, "metadata", None) or ctx.room.metadata or "{}"
    ```
  - Caller name, company, and use case are now immediately extracted, enabling personalized greetings like:
    *"Hi Aditya! I'm Aria, Solutions Consultant with Acuron AI..."*

---

### 7. The 512 MB Out-Of-Memory (OOM) Kernel Crash
* **Symptom**: In Render dashboard, the service crashed 6 seconds after a call connected with the purple error alert:  
  `Instance failed: 67hjb — Ran out of memory (used over 512MB) while running your code.`
* **Root Cause**:
  1. By default, `livekit.agents` uses `JobExecutorType.PROCESS` and keeps `num_idle_processes = min(cpu_count(), 4)`.
  2. On a Linux container host reporting 4 CPU cores, LiveKit pre-forked 4 separate Python processes.
  3. When an incoming call was received, it forked an additional job process (`pid: 93`).
  4. Each process held copies of PyTorch, Silero VAD, ONNX Runtime, and WebRTC audio pipelines.
  5. The `requirements.txt` also included `noise-cancellation` (Krisp deep-learning model), adding extra heap allocations. Total RAM surged past 540 MB, triggering the Linux kernel cgroup OOM killer.
* **Resolution**:
  - Configured `job_executor_type = JobExecutorType.THREAD`: All incoming calls are handled concurrently in lightweight async threads within a **single Python process**.
  - Set `num_idle_processes = 0` to disable idle child worker forking.
  - Removed the unneeded `noise-cancellation` package.
  - **Result**: Measured memory consumption dropped from **>540 MB down to ~161 MB** (a **70% memory reduction**), completely eliminating the OOM crash.

---

## 🚀 Unresolved Challenges & Active Pipeline

The following high-priority items are currently in the engineering pipeline:

### 1. Telephony Audio Clarity & Codec Downsampling
* **The Problem**:
  - The voice synthesized by Sarvam AI (`bulbul:v3`) sounds intelligible but has noticeable digital fuzziness, metallic grain, and low clarity over phone calls.
  - **Technical Reason**: Sarvam synthesizes audio at **24,000 Hz / 48,000 Hz** (high-definition WebRTC format). When routed over a telephone network via SIP (Vobiz), the carrier transcodes the audio down to standard PSTN telephony codecs: **G.711 &mu;-law / A-law at 8,000 Hz**. This unmanaged lossy decimation removes high frequencies and introduces quantization noise.
* **Planned Solution**:
  1. **Direct Telephony Resampling**: Add a real-time resampling filter in the audio output pipeline (using `soxr` or `scipy.signal.resample_poly`) to cleanly downsample from 24kHz to 8kHz before SIP packetization.
  2. **Multi-Model Provider Fallback**: Benchmark **Cartesia Sonic** and **ElevenLabs Flash v2.5** configured with native 8kHz / 16kHz PCM output profiles tuned specifically for PSTN telephone lines.
  3. **Acoustic Jitter Tuning**: Adjust LiveKit's WebRTC audio jitter buffer parameters to smooth out packet delivery over mobile 4G/5G cell towers.

---

### 2. Persistent Database & Call Transcript Storage
* **The Problem**:
  - Once a phone call ends, the transcript, caller details, and conversational data evaporate from memory. There is no historical dashboard, CRM record, or analytics log.
* **Planned Solution**:
  1. **Database Schema (PostgreSQL / Supabase)**:
     ```sql
     CREATE TABLE call_logs (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         call_id VARCHAR(64) UNIQUE NOT NULL,
         caller_name VARCHAR(100),
         caller_phone VARCHAR(20),
         caller_company VARCHAR(100),
         use_case VARCHAR(100),
         duration_seconds INT,
         call_status VARCHAR(30),
         transcript JSONB,
         summary TEXT,
         qualification_score INT,
         created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     );
     ```
  2. **Webhook Ingestion**: Implement `POST /api/webhooks/call-ended` on the Next.js server, invoked by LiveKit Room Egress or the worker's `on_exit` hook to insert completed call records.

---

### 3. Cross-Call State Management & Caller Memory
* **The Problem**:
  - If a prospect calls a second time or experiences a dropped call, Aria treats them as a complete stranger with zero memory of their prior conversation.
* **Planned Solution**:
  1. **Redis / Upstash Key-Value Store**: Store caller state keyed by normalized phone number:
     `caller:{+919921347249}:profile` &rarr; stores prior company, pain points discussed, and stage in sales funnel.
  2. **Context Injection**: During `entrypoint(ctx)`, query Redis for the caller's history and inject a memory block into the system prompt:
     ```
     Returning Caller Context:
     - Previously called on Sept 7 regarding Claims Automation.
     - Expressed budget approval timeline of Q4.
     Greet them warmly as a returning contact!
     ```

---

### 4. Post-Call Lead Qualification & CRM Ingestion Webhooks
* **The Problem**:
  - Sales consultants at Acuron AI must manually check server logs to know if a high-intent prospect requested a follow-up.
* **Planned Solution**:
  1. **Post-Call LLM Summary Task**: When the call disconnects, run a fast background LLM pass on the complete transcript to extract:
     - Identified Pain Points
     - Budget / Timeline
     - Interest Level (Hot / Warm / Cold)
  2. **Direct Integrations**:
     - **Slack/Discord Webhook**: Send instant notification to `#sales-leads` with call summary and recording link.
     - **HubSpot / Salesforce API**: Automatically create or update the Lead / Deal record.

---

### 5. Free-Tier Container Spin-Down / Cold Starts
* **The Problem**:
  - On Render's Free Tier, web services spin down after 15 minutes of inactivity. If a visitor triggers a call while the service is asleep, cold start delays can exceed 50 seconds.
* **Planned Solution**:
  1. **Production Worker**: Move backend worker to a persistent Render/Railway instance ($5–$7/mo) with zero sleep and persistent CPU.
  2. **Wake-Up Ping**: Implement a pre-call wake-up check in `web/src/app/api/call/route.ts` that pings `https://voice-agent-vphp.onrender.com/` on form focus to start warming the container before the user clicks "Call Me Now".

---

*Authored by the Acuron AI Voice Agent Engineering Team — September 2026*
