"""
agent.py — LiveKit agent worker for the "Call Me" AI voice demo.

Architecture:
  LiveKit dispatches this worker when a call is triggered via the web form.
  The pipeline: Deepgram STT → Groq LLM → Sarvam TTS

Run locally (text-only, no phone):
  python agent.py console

Run as a persistent worker (Railway/Render):
  python agent.py start

Environment variables required (see .env.example):
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
  DEEPGRAM_API_KEY, GROQ_API_KEY, SARVAM_API_KEY
"""

import asyncio
import json
import logging
import time

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
)

from livekit.plugins import deepgram, groq, sarvam, silero

import persona

# ---------------------------------------------------------------------------
# Logging — verbose so Railway/Render logs are useful during a live demo
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("voice-agent")

load_dotenv()


# ---------------------------------------------------------------------------
# ReceptionistAgent — the Agent subclass that holds conversation logic
# ---------------------------------------------------------------------------
class ReceptionistAgent(Agent):
    """
    Stateful agent class.  Stores caller metadata so the greeting can be
    personalised ("Hi, is this Rohan?") and enforces the hard call timeout.
    """

    def __init__(self, caller_name: str, caller_context: str):
        self.caller_name = caller_name
        self.caller_context = caller_context
        self._call_start: float = 0.0

        # Build the initial greeting based on whether we have a name
        if caller_name:
            greeting = persona.GREETING_WITH_NAME.format(
                name=caller_name,
                agent=persona.AGENT_NAME,
                business=persona.BUSINESS_NAME,
            )
        else:
            greeting = persona.GREETING_GENERIC.format(
                agent=persona.AGENT_NAME,
                business=persona.BUSINESS_NAME,
            )

        # Build the full system prompt, optionally appending caller context
        system = persona.SYSTEM_PROMPT
        if caller_context:
            system += (
                f"\n\nContext the caller provided when they filled the form:\n"
                f'"{caller_context}"\n'
                "Work this into the conversation naturally where relevant."
            )

        logger.info(
            "ReceptionistAgent initialised | caller=%r context=%r",
            caller_name,
            caller_context[:80] if caller_context else "",
        )

        super().__init__(instructions=system)
        self._greeting = greeting

    # ------------------------------------------------------------------
    # Lifecycle hooks
    # ------------------------------------------------------------------

    async def on_enter(self) -> None:
        """Called once the agent joins the room.  Speak the opening greeting."""
        self._call_start = time.time()
        logger.info("CALL STARTED — speaking greeting to caller=%r", self.caller_name)
        self.session.say(self._greeting)

    async def on_user_turn_completed(
        self,
        turn_ctx,          # livekit.agents.TurnContext
        new_message,       # livekit.agents.ChatMessage
    ) -> None:
        """
        Called after every STT transcription is complete.
        Log the transcript, check for goodbye intent, check the hard timeout.
        """
        text = new_message.text_content or ""
        logger.info("STT RESULT: %r", text)

        # --- Goodbye intent detection ---
        lower = text.lower()
        for phrase in persona.GOODBYE_PHRASES:
            if phrase in lower:
                logger.info("Goodbye phrase detected (%r) — ending call", phrase)
                handle = self.session.generate_reply(
                    instructions=(
                        "The caller just said something that indicates they want to end the call. "
                        "Thank them warmly, wish them a great day, and say goodbye."
                    )
                )
                await handle.wait_for_playout()
                if self.session.room_io and self.session.room_io.room:
                    await self.session.room_io.room.disconnect()
                return

        # --- Hard timeout ---
        elapsed = time.time() - self._call_start
        if elapsed >= persona.MAX_CALL_DURATION_SECONDS:
            logger.info(
                "Hard timeout reached (%.0fs) — ending call", elapsed
            )
            handle = self.session.generate_reply(
                instructions=(
                    "We've been talking for a few minutes — time to wrap up. "
                    "Thank the caller warmly and say a friendly goodbye."
                )
            )
            await handle.wait_for_playout()
            if self.session.room_io and self.session.room_io.room:
                await self.session.room_io.room.disconnect()
            return


# ---------------------------------------------------------------------------
# entrypoint — called by the LiveKit worker for every dispatched job
# ---------------------------------------------------------------------------
async def entrypoint(ctx: JobContext) -> None:
    """
    Main job handler.  Reads caller metadata from room metadata or participant
    attributes, wires up the STT → LLM → TTS pipeline, and starts the session.
    """
    logger.info(
        "JOB RECEIVED | room=%s job_id=%s",
        ctx.room.name,
        ctx.job.id,
    )

    # ------------------------------------------------------------------
    # 1. Connect to the room
    # ------------------------------------------------------------------
    await ctx.connect()
    logger.info("Connected to room %s", ctx.room.name)

    # ------------------------------------------------------------------
    # 2. Extract caller metadata (name + context) from room metadata.
    #    The web /api/call route encodes these as JSON in room.metadata.
    # ------------------------------------------------------------------
    caller_name = ""
    caller_context = ""
    try:
        meta_raw = ctx.room.metadata or "{}"
        meta = json.loads(meta_raw)
        caller_name = meta.get("caller_name", "")
        caller_context = meta.get("caller_context", "")
        logger.info(
            "Room metadata parsed | name=%r context_len=%d",
            caller_name,
            len(caller_context),
        )
    except Exception as exc:
        logger.warning("Failed to parse room metadata: %s", exc)

    # ------------------------------------------------------------------
    # 3. Build the STT / LLM / TTS pipeline using official plugins.
    #    All credentials come from env vars — never hardcoded.
    # ------------------------------------------------------------------
    logger.info("Initialising STT (Deepgram) / LLM (Groq) / TTS (Sarvam) …")

    try:
        stt = deepgram.STT(
            model="nova-3",         # Best general-purpose Deepgram model as of 2025
            language="en-IN",       # Indian English — callers are in India
        )
    except Exception as exc:
        logger.error("Failed to initialise Deepgram STT: %s", exc)
        raise

    try:
        llm = groq.LLM(
            model="llama-3.3-70b-versatile",   # Fast, capable Groq model
        )
    except Exception as exc:
        logger.error("Failed to initialise Groq LLM: %s", exc)
        raise

    try:
        tts = sarvam.TTS(
            model="bulbul:v3",      # Sarvam's Bulbul TTS model
            target_language_code="en-IN",
        )
    except Exception as exc:
        logger.error("Failed to initialise Sarvam TTS: %s", exc)
        raise

    # VAD (voice activity detection) is required for the pipeline
    try:
        vad = silero.VAD.load()
    except Exception as exc:
        logger.error("Failed to load Silero VAD: %s", exc)
        raise

    # ------------------------------------------------------------------
    # 4. Create the agent and the session
    # ------------------------------------------------------------------
    agent = ReceptionistAgent(
        caller_name=caller_name,
        caller_context=caller_context,
    )

    session = AgentSession(
        stt=stt,
        llm=llm,
        tts=tts,
        vad=vad,
    )

    logger.info("Starting AgentSession …")

    try:
        await session.start(
            agent,
            room=ctx.room,
        )
        logger.info("AgentSession running")
    except Exception as exc:
        logger.error("AgentSession failed to start: %s", exc)
        raise

    # ------------------------------------------------------------------
    # 5. Keep the worker alive until the room closes or timeout fires
    # ------------------------------------------------------------------
    try:
        disconnect_event = asyncio.Event()
        ctx.room.on("disconnected", lambda *_: disconnect_event.set())
        await disconnect_event.wait()
    except Exception as exc:
        logger.warning("Room disconnected with error: %s", exc)
    finally:
        logger.info(
            "CALL ENDED | room=%s duration=%.1fs",
            ctx.room.name,
            time.time() - (agent._call_start or time.time()),
        )


# ---------------------------------------------------------------------------
# Entry point — `python agent.py start` or `python agent.py console`
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            # Named agent — the web trigger dispatches to this specific name.
            # Must match the agent_name used in the /api/call dispatch call.
            agent_name="voice-receptionist",
        )
    )
