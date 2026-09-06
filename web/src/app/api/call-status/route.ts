/**
 * app/api/call-status/route.ts
 *
 * GET /api/call-status?room=<roomName>
 *
 * Polls the LiveKit Room Service to determine the current call state.
 * Returns one of: connecting | ringing | active | ended | error
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoomServiceClient } from "@/lib/livekit-server";

export async function GET(req: NextRequest) {
  const roomName = req.nextUrl.searchParams.get("room");
  if (!roomName) {
    return NextResponse.json({ error: "room param required" }, { status: 400 });
  }

  try {
    const roomClient = getRoomServiceClient();
    const rooms = await roomClient.listRooms([roomName]);

    if (!rooms || rooms.length === 0) {
      // Room doesn't exist yet or already closed
      return NextResponse.json({ status: "ended", detail: "Room has closed." });
    }

    const room = rooms[0];
    const participants = await roomClient.listParticipants(roomName);

    // Determine status based on participant count and types
    const agentParticipant = participants.find(
      (p) =>
        p.identity?.startsWith("voice-receptionist") ||
        p.kind?.toString() === "2" // ParticipantKind.AGENT = 2
    );
    const sipParticipant = participants.find(
      (p) => p.identity?.startsWith("sip-")
    );

    let status: string;
    let detail: string;

    if (!agentParticipant && !sipParticipant) {
      status = "connecting";
      detail = "Waiting for agent and SIP participant…";
    } else if (agentParticipant && !sipParticipant) {
      status = "ringing";
      detail = "Agent connected, ringing your phone…";
    } else if (agentParticipant && sipParticipant) {
      status = "active";
      detail = "Aria is speaking with you.";
    } else {
      status = "connecting";
      detail = "Initialising…";
    }

    return NextResponse.json({
      status,
      detail,
      roomName,
      numParticipants: room.numParticipants,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[/api/call-status] ERROR: ${message}`);
    return NextResponse.json(
      { status: "error", detail: message },
      { status: 500 }
    );
  }
}
