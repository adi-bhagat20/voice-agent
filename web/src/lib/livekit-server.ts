/**
 * lib/livekit-server.ts
 *
 * Thin wrapper around livekit-server-sdk for use in Next.js API routes.
 * All credentials come from environment variables — never hardcoded.
 */

import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
  SipClient,
} from "livekit-server-sdk";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getLiveKitConfig() {
  return {
    url: requireEnv("LIVEKIT_URL"),
    apiKey: requireEnv("LIVEKIT_API_KEY"),
    apiSecret: requireEnv("LIVEKIT_API_SECRET"),
    sipTrunkId: requireEnv("SIP_OUTBOUND_TRUNK_ID"),
    callerPhone: process.env.CALLER_PHONE_NUMBER || "",
  };
}

export function getRoomServiceClient() {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  return new RoomServiceClient(url, apiKey, apiSecret);
}

export function getSipClient() {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  return new SipClient(url, apiKey, apiSecret);
}

export function getAgentDispatchClient() {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  return new AgentDispatchClient(url, apiKey, apiSecret);
}

/**
 * Creates a short-lived access token for a participant to join a room.
 * Only used for the call-status page to listen in (muted) and watch state.
 */
export function createParticipantToken(
  roomName: string,
  participantIdentity: string
): string {
  const { apiKey, apiSecret } = getLiveKitConfig();
  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    ttl: "10m",
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: false,
    canSubscribe: true,
  });
  return at.toJwt() as unknown as string;
}
