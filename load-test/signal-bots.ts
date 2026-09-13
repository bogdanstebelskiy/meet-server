// Load-generates the realtime<->sfu signaling path directly - no browser, no
// frontend, no Clerk, no real ICE/DTLS/RTP. connectWebRtcTransport/produce/
// consume are pure signaling RPCs that don't need real connectivity to
// succeed (same trick apps/realtime's own e2e suite uses), and realtime's
// WS gateway has no auth check at all. This tests what this repo actually
// built - room-to-sfu-instance routing and signaling throughput across
// replicas - not raw per-participant media-encode cost (that's what the
// Chromium-based bots.ts measured, and it bottlenecked on itself well
// below sfu's real capacity).
//
// One Node process can hold thousands of these socket connections - each
// "peer" costs a TCP/WS connection plus a handful of JSON round trips.
//
// Usage: tsx signal-bots.ts <roomPrefix> <roomCount> <peersPerRoom> [holdSeconds]
import * as crypto from 'node:crypto';
import { io, type Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.LOAD_TEST_SIGNALING_URL ?? 'https://localhost:3000';
const RPC_TIMEOUT_MS = 15000;

function fakeDtlsParameters() {
  const fingerprint = crypto
    .randomBytes(32)
    .toString('hex')
    .toUpperCase()
    .match(/.{2}/g)!
    .join(':');

  return {
    role: 'client',
    fingerprints: [{ algorithm: 'sha-256', value: fingerprint }],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function audioProducerRtpParameters(routerRtpCapabilities: any, ssrc: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opus = routerRtpCapabilities.codecs.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (codec: any) => codec.mimeType.toLowerCase() === 'audio/opus',
  );

  return {
    codecs: [
      {
        mimeType: opus.mimeType,
        payloadType: opus.preferredPayloadType,
        clockRate: opus.clockRate,
        channels: opus.channels,
        parameters: opus.parameters ?? {},
        rtcpFeedback: opus.rtcpFeedback ?? [],
      },
    ],
    encodings: [{ ssrc }],
    rtcp: { cname: `load-test-cname-${ssrc}` },
  };
}

function emitAsync<T = unknown>(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${event} timed out after ${RPC_TIMEOUT_MS}ms`));
    }, RPC_TIMEOUT_MS);

    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function connectSocket(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(SIGNALING_URL, {
      transports: ['websocket'],
      forceNew: true,
      rejectUnauthorized: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

let ssrcCounter = 1;

interface PeerResult {
  ok: boolean;
  error?: string;
  socket?: Socket;
}

async function runPeer(roomId: string, peerLabel: string): Promise<PeerResult> {
  let socket: Socket | undefined;
  try {
    const activeSocket = await connectSocket();
    socket = activeSocket;
    const consumedProducerIds = new Set<string>();
    let rtpCapabilities: unknown;

    activeSocket.on(
      'newProducer',
      (payload: { peerId: string; producerId: string; kind: string }) => {
        if (consumedProducerIds.has(payload.producerId)) return;
        consumedProducerIds.add(payload.producerId);
        emitAsync(activeSocket, 'consume', {
          producerId: payload.producerId,
          rtpCapabilities,
        }).catch(() => {
          // A late-arriving producer for a peer that's already left/closed
          // its room is not this load test's concern - only join/produce
          // throughput is being measured.
        });
      },
    );

    await emitAsync(activeSocket, 'join', { roomId, displayName: peerLabel });
    rtpCapabilities = await emitAsync(activeSocket, 'getRouterRtpCapabilities');

    const sendTransport = await emitAsync<{ id: string }>(
      activeSocket,
      'createWebRtcTransport',
      { direction: 'send' },
    );
    await emitAsync(activeSocket, 'connectWebRtcTransport', {
      transportId: sendTransport.id,
      dtlsParameters: fakeDtlsParameters(),
    });

    const recvTransport = await emitAsync<{ id: string }>(
      activeSocket,
      'createWebRtcTransport',
      { direction: 'recv' },
    );
    await emitAsync(activeSocket, 'connectWebRtcTransport', {
      transportId: recvTransport.id,
      dtlsParameters: fakeDtlsParameters(),
    });

    await emitAsync(activeSocket, 'produce', {
      transportId: sendTransport.id,
      kind: 'audio',
      rtpParameters: audioProducerRtpParameters(rtpCapabilities, ssrcCounter++),
    });

    return { ok: true, socket: activeSocket };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, socket };
  }
}

async function runRoom(roomId: string, peersPerRoom: number): Promise<PeerResult[]> {
  const results: PeerResult[] = [];
  for (let index = 0; index < peersPerRoom; index++) {
    results.push(await runPeer(roomId, `bot-${roomId}-${index}`));
  }
  return results;
}

async function main() {
  const [roomPrefix, roomCountRaw, peersPerRoomRaw, holdSecondsRaw] =
    process.argv.slice(2);

  if (!roomPrefix || !roomCountRaw || !peersPerRoomRaw) {
    console.error(
      'Usage: tsx signal-bots.ts <roomPrefix> <roomCount> <peersPerRoom> [holdSeconds]',
    );
    process.exit(1);
  }

  const roomCount = Number(roomCountRaw);
  const peersPerRoom = Number(peersPerRoomRaw);
  const holdSeconds = holdSecondsRaw ? Number(holdSecondsRaw) : 20;
  const roomConcurrency = Number(process.env.LOAD_TEST_ROOM_CONCURRENCY ?? '20');

  // All rooms starting at once means every room's first peer opens a new
  // connection in the same instant - a connection-rate burst, confirmed by
  // testing to cause "websocket error" failures regardless of how many
  // separate OS processes generate it (splitting into 8 processes didn't
  // help, and neither did removing TLS - it's the connection rate itself).
  // Capping how many rooms are ever starting up at once smooths that out.
  const allResults: PeerResult[] = [];
  for (let start = 0; start < roomCount; start += roomConcurrency) {
    const batchRoomIndexes = Array.from(
      { length: Math.min(roomConcurrency, roomCount - start) },
      (_unused, offset) => start + offset,
    );
    const batchPromises = batchRoomIndexes.map((index) =>
      runRoom(`${roomPrefix}-room-${index}`, peersPerRoom),
    );
    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults.flat());
  }

  const succeeded = allResults.filter((result) => result.ok);
  const failed = allResults.filter((result) => !result.ok);
  // failed results still carry their socket (needed below for a graceful
  // disconnect) - a Socket has circular references, so only serialize the
  // plain fields, never the object itself.
  const serializableFailures = failed
    .slice(0, 10)
    .map((result) => ({ error: result.error }));

  console.log(
    JSON.stringify({
      roomCount,
      peersPerRoom,
      totalPeers: allResults.length,
      succeeded: succeeded.length,
      failed: failed.length,
      failures: serializableFailures,
    }),
  );

  if (holdSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1000));
  }

  // A synchronous mass-disconnect (killing the process outright) overwhelms
  // realtime's leave()->closeRoom() cascade at scale - confirmed by testing:
  // it left hundreds of MediaRooms orphaned on sfu, since that REST call is
  // fire-and-forget with no retry. Disconnect in small batches instead.
  const sockets = allResults
    .map((result) => result.socket)
    .filter((socket): socket is Socket => socket !== undefined);
  const disconnectBatchSize = 25;
  for (let start = 0; start < sockets.length; start += disconnectBatchSize) {
    const batch = sockets.slice(start, start + disconnectBatchSize);
    for (const socket of batch) socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('signal-bots.ts failed:', error);
  process.exit(1);
});
