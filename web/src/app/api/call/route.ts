/**
 * app/api/call/route.ts
 *
 * POST /api/call
 *
 * Receives caller info from the web form, then:
 *  1. Creates a LiveKit room with caller metadata encoded in room.metadata
 *  2. Dispatches the "voice-receptionist" agent to that room
 *  3. Triggers an outbound SIP call to the caller's phone number via Vobiz
 *
 * Returns: { roomName, callId, message }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAgentDispatchClient,
  getLiveKitConfig,
  getRoomServiceClient,
  getSipClient,
} from "@/lib/livekit-server";

// ── validation helpers ────────────────────────────────────────────────────────

const E164_RE = /^\+[1-9]\d{6,14}$/;

function isValidE164(phone: string): boolean {
  return E164_RE.test(phone.trim());
}

// ── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, phone, context } = body as {
    name?: string;
    phone?: string;
    context?: string;
  };

  // ── input validation ──────────────────────────────────────────────────────
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  if (!phone || !isValidE164(phone.trim())) {
    return NextResponse.json(
      {
        error:
          "phone must be in E.164 format, e.g. +919876543210",
      },
      { status: 400 }
    );
  }

  const callerName = name.trim().slice(0, 80);
  const callerPhone = phone.trim();
  const callerContext = (context ?? "").trim().slice(0, 500);

  // ── unique room name for this call ────────────────────────────────────────
  const timestamp = Date.now();
  const roomName = `call-${timestamp}-${callerName.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`;

  console.log(
    `[/api/call] Incoming call request | name=${callerName} phone=${callerPhone} room=${roomName}`
  );

  try {
    const config = getLiveKitConfig();

    // 1. Create the room with caller metadata
    const roomClient = getRoomServiceClient();
    const metadata = JSON.stringify({
      caller_name: callerName,
      caller_context: callerContext,
    });

    await roomClient.createRoom({
      name: roomName,
      emptyTimeout: 120, // close room if no one joins within 2 min
      maxParticipants: 5,
      metadata,
    });
    console.log(`[/api/call] Room created: ${roomName}`);

    // 2. Dispatch the voice-receptionist agent to the room
    const dispatchClient = getAgentDispatchClient();
    const dispatch = await dispatchClient.createDispatch(roomName, "voice-receptionist", {
      metadata: JSON.stringify({ caller_name: callerName, caller_context: callerContext }),
    });
    console.log(`[/api/call] Agent dispatched | dispatch_id=${dispatch.id}`);

    // 3. Create SIP outbound call — rings the caller's actual phone
    const sipClient = getSipClient();
    const sipParticipant = await sipClient.createSipParticipant(
      config.sipTrunkId,
      callerPhone,
      roomName,
      {
        participantIdentity: `sip-${callerPhone}`,
        participantName: callerName,
        playDialtone: true,
        waitUntilAnswered: false, // don't block; the agent greets when answered
      }
    );
    console.log(
      `[/api/call] SIP call initiated | participant_id=${sipParticipant.participantIdentity}`
    );

    return NextResponse.json({
      success: true,
      roomName,
      callId: dispatch.id,
      message: `Calling ${callerName} at ${callerPhone}…`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/api/call] ERROR: ${message}`);
    return NextResponse.json(
      { error: "Failed to initiate call", detail: message },
      { status: 500 }
    );
  }
}
