"""
agent.py — LiveKit agent worker for the Acuron AI Voice Demo.

Architecture:
  LiveKit dispatches this worker when a call is triggered via the web form.
  The pipeline: Deepgram STT (nova-3) → Groq LLM (openai/gpt-oss-20b) → Sarvam TTS (bulbul:v3)

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
    llm as agent_llm,
)

from livekit import rtc
from livekit.agents.utils import participant as participant_utils
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
logger = logging.getLogger("acuron-voice-agent")

load_dotenv()


# ---------------------------------------------------------------------------
# ReceptionistAgent — the Agent subclass that holds conversation logic
# ---------------------------------------------------------------------------
class ReceptionistAgent(Agent):
    """
    Stateful agent class for Acuron AI. Stores caller metadata, builds dynamic
    greetings and context, and enforces natural conversation boundaries.
    """

    def __init__(
        self,
        caller_name: str = "",
        caller_company: str = "",
        caller_use_case: str = "",
        caller_context: str = "",
    ):
        self.caller_name = caller_name
        self.caller_company = caller_company
        self.caller_use_case = caller_use_case
        self.caller_context = caller_context
        self._call_start: float = 0.0

        # Build the dynamic opening greeting
        greeting = persona.build_greeting(
            name=caller_name,
            company=caller_company,
            use_case=caller_use_case,
        )

        # Build the full system prompt with specific caller context
        system = persona.SYSTEM_PROMPT
        context_parts = []
        if caller_name:
            context_parts.append(f"- Caller Name: {caller_name}")
        if caller_company:
            context_parts.append(f"- Company: {caller_company}")
        if caller_use_case:
            context_parts.append(f"- Requested Solution / Use Case: {caller_use_case}")
        if caller_context:
            context_parts.append(f"- Specific Problem / Goal: {caller_context}")

        if context_parts:
            system += "\n\nCaller Context from Request Form:\n" + "\n".join(context_parts)
            system += "\nNaturally weave this context into the conversation without sounding robotic."

        logger.info(
            "ReceptionistAgent initialized | caller=%r company=%r use_case=%r",
            caller_name,
            caller_company,
            caller_use_case,
        )

        super().__init__(instructions=system)
        self._greeting = greeting

    # ------------------------------------------------------------------
    # Lifecycle hooks
    # ------------------------------------------------------------------

    async def on_enter(self) -> None:
        """Called once the agent joins and starts. Speaks the opening greeting."""
        self._call_start = time.time()
        logger.info("CALL ACTIVE — speaking opening greeting to caller=%r", self.caller_name)
        self.session.say(self._greeting)

    async def on_user_turn_completed(
        self,
        turn_ctx: agent_llm.ChatContext,
        new_message: agent_llm.ChatMessage,
    ) -> None:
        """
        Called after caller finishes speaking and transcription completes.
        Checks for goodbye intent and call safety timeouts.
        """
        text = new_message.text_content or ""
        logger.info("CALLER SPOKE: %r", text)

        # --- Goodbye intent detection ---
        lower = text.lower()
        for phrase in persona.GOODBYE_PHRASES:
            if phrase in lower:
                logger.info("Goodbye intent detected (%r) — wrapping up call", phrase)
                handle = self.session.generate_reply(
                    instructions=(
                        "The caller wants to end the conversation. "
                        "Warmly thank them for exploring Acuron AI, wish them a great day, and say goodbye."
                    )
                )
                await handle.wait_for_playout()
                if self.session.room_io and self.session.room_io.room:
                    await self.session.room_io.room.disconnect()
                return

        # --- Hard timeout check ---
        elapsed = time.time() - self._call_start
        if elapsed >= persona.MAX_CALL_DURATION_SECONDS:
            logger.info("Hard timeout reached (%.0fs) — concluding call", elapsed)
            handle = self.session.generate_reply(
                instructions=(
                    "The demo has reached its 3-minute limit. "
                    "Politely thank the caller for testing the Acuron AI voice demo and say a friendly goodbye."
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
    Main job handler.
    1. Connects to LiveKit room.
    2. Parses caller metadata from the web submission.
    3. Initializes Deepgram STT, Groq LLM, and Sarvam TTS.
    4. Waits for caller phone participant to answer.
    5. Starts voice session and plays personalized greeting.
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
    logger.info("Worker connected to room: %s", ctx.room.name)

    # ------------------------------------------------------------------
    # 2. Extract caller metadata from room metadata
    # ------------------------------------------------------------------
    caller_name = ""
    caller_company = ""
    caller_use_case = ""
    caller_context = ""
    try:
        meta_raw = ctx.room.metadata or "{}"
        meta = json.loads(meta_raw)
        caller_name = meta.get("caller_name", "")
        caller_company = meta.get("caller_company", "")
        caller_use_case = meta.get("caller_use_case", "")
        caller_context = meta.get("caller_context", "")
        logger.info(
            "Room metadata parsed | name=%r company=%r use_case=%r",
            caller_name,
            caller_company,
            caller_use_case,
        )
    except Exception as exc:
        logger.warning("Failed to parse room metadata: %s", exc)

    # ------------------------------------------------------------------
    # 3. Build STT / LLM / TTS pipeline
    # ------------------------------------------------------------------
    logger.info("Initializing STT (Deepgram) / LLM (Groq) / TTS (Sarvam) …")

    try:
        stt = deepgram.STT(
            model="nova-3",
            language="en-IN",
        )
    except Exception as exc:
        logger.error("Failed to initialize Deepgram STT: %s", exc)
        raise

    try:
        # Verified fast model on Groq API
        llm = groq.LLM(
            model="openai/gpt-oss-20b",
        )
    except Exception as exc:
        logger.error("Failed to initialize Groq LLM: %s", exc)
        raise

    try:
        tts = sarvam.TTS(
            model="bulbul:v3",
            target_language_code="en-IN",
        )
    except Exception as exc:
        logger.error("Failed to initialize Sarvam TTS: %s", exc)
        raise

    try:
        vad = silero.VAD.load()
    except Exception as exc:
        logger.error("Failed to load Silero VAD: %s", exc)
        raise

    # ------------------------------------------------------------------
    # 4. Wait for the phone call to be answered
    # ------------------------------------------------------------------
    logger.info("Waiting for caller to connect to room...")
    try:
        # Wait up to 45 seconds for participant to join
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=45.0)
        logger.info("Participant joined room | identity=%s kind=%s", participant.identity, participant.kind)

        # If it's a telephone call (SIP), wait until the user answers the phone!
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            call_status = participant.attributes.get("sip.callStatus")
            logger.info("SIP initial callStatus: %r", call_status)
            if call_status != "active":
                logger.info("Phone is ringing... waiting for caller to answer...")
                try:
                    await asyncio.wait_for(
                        participant_utils.wait_for_participant_attribute(
                            ctx.room,
                            identity=participant.identity,
                            attribute="sip.callStatus",
                            value="active",
                        ),
                        timeout=35.0,
                    )
                    logger.info("Caller answered phone! (sip.callStatus == 'active')")
                    # Brief pause so the audio channel is stable when greeting starts
                    await asyncio.sleep(0.5)
                except Exception as err:
                    logger.warning("Error/timeout waiting for sip.callStatus active: %s", err)
    except asyncio.TimeoutError:
        logger.warning("No participant joined within 45s, proceeding with session startup")

    # ------------------------------------------------------------------
    # 5. Create agent and start session
    # ------------------------------------------------------------------
    agent = ReceptionistAgent(
        caller_name=caller_name,
        caller_company=caller_company,
        caller_use_case=caller_use_case,
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
        logger.info("AgentSession active and running")
    except Exception as exc:
        logger.error("AgentSession failed to start: %s", exc)
        raise

    # ------------------------------------------------------------------
    # 6. Keep the worker alive until room closes or disconnects
    # ------------------------------------------------------------------
    try:
        disconnect_event = asyncio.Event()
        ctx.room.on("disconnected", lambda *_: disconnect_event.set())
        await disconnect_event.wait()
    except Exception as exc:
        logger.warning("Room disconnected with error: %s", exc)
    finally:
        duration = time.time() - (agent._call_start or time.time())
        logger.info("CALL ENDED | room=%s duration=%.1fs", ctx.room.name, duration)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os
    port = int(os.getenv("PORT", "8081"))
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="voice-receptionist",
            port=port,
            host="0.0.0.0",
        )
    )
