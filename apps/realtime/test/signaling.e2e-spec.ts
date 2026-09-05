import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type Redis from 'ioredis';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AppModule as SfuAppModule } from '../../sfu/src/app.module';
import { MediaRoomsService } from '../../sfu/src/media-rooms/media-rooms.service';
import { REDIS_CLIENT } from '../src/redis/redis.provider';

// Two real NestJS apps (apps/realtime + apps/sfu) talking over real HTTP,
// driven by real socket.io clients against apps/realtime. No real ICE/DTLS/
// RTP since there's no browser: dtlsParameters are fabricated, and
// connectWebRtcTransport/produce/consume are pure signaling RPCs that don't
// need real connectivity. See docs/sfu-signaling-design.md for the two bugs
// this suite found and now regression-tests as fixed.

jest.setTimeout(30000);

function listenOnEphemeralPort(app: INestApplication): Promise<string> {
  return app.listen(0).then(() => {
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;

    return `http://127.0.0.1:${port}`;
  });
}

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

function audioProducerRtpParameters(routerRtpCapabilities: any, ssrc: number) {
  const opus = routerRtpCapabilities.codecs.find(
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
    rtcp: { cname: `test-cname-${ssrc}` },
  };
}

describe('Signaling (e2e)', () => {
  let sfuApp: INestApplication;
  let app: INestApplication;
  let baseUrl: string;
  let sfuServiceUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const sfuModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [SfuAppModule],
    }).compile();

    sfuApp = sfuModuleFixture.createNestApplication();
    sfuServiceUrl = await listenOnEphemeralPort(sfuApp);

    // Read by apps/realtime's SfuClientModule (HttpModule.registerAsync)
    // when AppModule below is compiled - must be set first.
    process.env.SFU_SERVICE_URL = sfuServiceUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    baseUrl = await listenOnEphemeralPort(app);
  });

  afterAll(async () => {
    // Close apps before quitting Redis, so no straggling gateway handler
    // can still issue a command once the connection's gone.
    await app.close();
    await sfuApp.close();

    // app.close() doesn't quit REDIS_CLIENT - it's a raw ioredis instance,
    // and left open it's a handle that keeps this process from exiting.
    const redis = app.get<Redis>(REDIS_CLIENT);
    await redis.quit();

    delete process.env.SFU_SERVICE_URL;
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    clients.length = 0;

    // disconnect() doesn't wait for the server's own leave()/Redis cleanup -
    // give it a moment so it can't race the next test's (or afterAll's) teardown.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  function connectClient(): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = io(baseUrl, { transports: ['websocket'], forceNew: true });
      clients.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  function emitAsync<T = any>(
    client: ClientSocket,
    event: string,
    payload?: unknown,
  ): Promise<T> {
    return new Promise((resolve) => {
      client.emit(event, payload, (response: T) => resolve(response));
    });
  }

  function waitForEvent<T = any>(
    client: ClientSocket,
    event: string,
  ): Promise<T> {
    return new Promise((resolve) => client.once(event, resolve));
  }

  // Races ack against the 'exception' event, reporting whichever fires.
  function observeOutcome(
    client: ClientSocket,
    event: string,
    payload: unknown,
  ): Promise<{ ack: unknown; exception: unknown }> {
    return new Promise((resolve) => {
      let ack: unknown = 'ACK_NOT_CALLED';
      let exception: unknown = 'EXCEPTION_NOT_EMITTED';

      client.emit(event, payload, (response: unknown) => {
        ack = response;
      });
      client.once('exception', (payload: unknown) => {
        exception = payload;
      });

      setTimeout(() => resolve({ ack, exception }), 500);
    });
  }

  describe('happy path', () => {
    it('walks join -> capabilities -> transports -> produce -> consume -> disconnect', async () => {
      const alice = await connectClient();
      const bob = await connectClient();

      const aliceJoin = await emitAsync(alice, 'join', {
        roomId: 'happy-room',
        displayName: 'Alice',
      });
      expect(aliceJoin).toEqual({ peerId: alice.id, existingPeers: [] });

      const bobNewPeer = waitForEvent(alice, 'newPeer');
      const bobJoin = await emitAsync(bob, 'join', {
        roomId: 'happy-room',
        displayName: 'Bob',
      });
      expect(bobJoin).toEqual({
        peerId: bob.id,
        existingPeers: [{ id: alice.id, displayName: 'Alice' }],
      });
      expect(await bobNewPeer).toEqual({ id: bob.id, displayName: 'Bob' });

      const rtpCapabilities = await emitAsync(
        alice,
        'getRouterRtpCapabilities',
      );
      expect(
        rtpCapabilities.codecs.some((c: any) => c.mimeType === 'audio/opus'),
      ).toBe(true);

      const aliceSendTransport = await emitAsync(
        alice,
        'createWebRtcTransport',
        {
          direction: 'send',
        },
      );
      expect(aliceSendTransport).toMatchObject({
        id: expect.any(String),
        iceParameters: expect.any(Object),
        iceCandidates: expect.any(Array),
        dtlsParameters: expect.any(Object),
      });
      // shape check: only client-facing fields, no mediasoup internals leaked
      expect(Object.keys(aliceSendTransport).sort()).toEqual(
        ['dtlsParameters', 'iceCandidates', 'iceParameters', 'id'].sort(),
      );

      const aliceConnected = await emitAsync(alice, 'connectWebRtcTransport', {
        transportId: aliceSendTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      expect(aliceConnected).toEqual({ connected: true });

      const bobRecvTransport = await emitAsync(bob, 'createWebRtcTransport', {
        direction: 'recv',
      });
      await emitAsync(bob, 'connectWebRtcTransport', {
        transportId: bobRecvTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });

      const bobNewProducer = waitForEvent(bob, 'newProducer');
      const produced = await emitAsync(alice, 'produce', {
        transportId: aliceSendTransport.id,
        kind: 'audio',
        rtpParameters: audioProducerRtpParameters(rtpCapabilities, 11111111),
      });
      expect(produced).toEqual({ id: expect.any(String) });
      expect(await bobNewProducer).toEqual({
        peerId: alice.id,
        producerId: produced.id,
        kind: 'audio',
      });

      const consumed = await emitAsync(bob, 'consume', {
        producerId: produced.id,
        rtpCapabilities,
      });
      expect(consumed).toMatchObject({
        id: expect.any(String),
        producerId: produced.id,
        kind: 'audio',
        rtpParameters: expect.any(Object),
      });

      const resumed = await emitAsync(bob, 'resumeConsumer', {
        consumerId: consumed.id,
      });
      expect(resumed).toEqual({ resumed: true });

      const alicePeerId = alice.id;
      const bobPeerClosed = waitForEvent(bob, 'peerClosed');
      alice.disconnect();
      expect(await bobPeerClosed).toEqual({ peerId: alicePeerId });
    });
  });

  describe('pitfalls', () => {
    it('regression: connectWebRtcTransport acks on success', async () => {
      const client = await connectClient();
      await emitAsync(client, 'join', {
        roomId: 'void-ack-room',
        displayName: 'Heidi',
      });
      const transport = await emitAsync(client, 'createWebRtcTransport', {
        direction: 'send',
      });

      const { ack, exception } = await observeOutcome(
        client,
        'connectWebRtcTransport',
        {
          transportId: transport.id,
          dtlsParameters: fakeDtlsParameters(),
        },
      );

      expect(ack).toEqual({ connected: true });
      expect(exception).toBe('EXCEPTION_NOT_EMITTED');
    });

    it('a protected event before join never acks, only surfaces via the exception event', async () => {
      const client = await connectClient();

      const { ack, exception } = await observeOutcome(
        client,
        'getRouterRtpCapabilities',
        undefined,
      );

      expect(ack).toBe('ACK_NOT_CALLED');
      expect(exception).toMatchObject({
        status: 'error',
        message: 'Socket has not joined a room yet',
        cause: { pattern: 'getRouterRtpCapabilities' },
      });
    });

    it('concurrent joins to a brand-new room land in one shared room', async () => {
      const dave = await connectClient();
      const erin = await connectClient();

      // Fired back-to-back, before either ack resolves: the exact race
      // RoomsService.getOrCreateRoom's pendingRooms map guards against.
      const davePromise = emitAsync(dave, 'join', {
        roomId: 'race-room',
        displayName: 'Dave',
      });
      const erinPromise = emitAsync(erin, 'join', {
        roomId: 'race-room',
        displayName: 'Erin',
      });

      const [, erinJoin] = await Promise.all([davePromise, erinPromise]);

      // If regressed, Erin wouldn't see Dave: they'd be on separate rooms.
      expect(erinJoin.existingPeers).toEqual([
        { id: dave.id, displayName: 'Dave' },
      ]);

      const rtpCapabilities = await emitAsync(dave, 'getRouterRtpCapabilities');
      const daveSendTransport = await emitAsync(dave, 'createWebRtcTransport', {
        direction: 'send',
      });
      await emitAsync(dave, 'connectWebRtcTransport', {
        transportId: daveSendTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });

      const erinNewProducer = waitForEvent(erin, 'newProducer');
      const produced = await emitAsync(dave, 'produce', {
        transportId: daveSendTransport.id,
        kind: 'audio',
        rtpParameters: audioProducerRtpParameters(rtpCapabilities, 22222222),
      });

      // Confirms both peers share one router: separate rooms wouldn't relay this.
      expect(await erinNewProducer).toEqual({
        peerId: dave.id,
        producerId: produced.id,
        kind: 'audio',
      });
    });

    it('regression: produce with a mismatched transportId surfaces the real NotFoundException message', async () => {
      const client = await connectClient();
      await emitAsync(client, 'join', {
        roomId: 'mismatch-room',
        displayName: 'Frank',
      });
      await emitAsync(client, 'createWebRtcTransport', { direction: 'send' });

      const { ack, exception } = await observeOutcome(client, 'produce', {
        transportId: 'this-id-does-not-exist',
        kind: 'audio',
        rtpParameters: {},
      });

      expect(ack).toBe('ACK_NOT_CALLED');
      expect(exception).toMatchObject({
        status: 'error',
        message: expect.stringContaining('not found for peer'),
        cause: { pattern: 'produce' },
      });
    });

    it('regression: consume before ever creating a recv transport surfaces the real NotFoundException message', async () => {
      // Needs a real producer, or router.canConsume() rejects before the
      // "no recv transport" check this test targets ever runs.
      const producerClient = await connectClient();
      await emitAsync(producerClient, 'join', {
        roomId: 'no-recv-room',
        displayName: 'Frank',
      });
      const rtpCapabilities = await emitAsync(
        producerClient,
        'getRouterRtpCapabilities',
      );
      const sendTransport = await emitAsync(
        producerClient,
        'createWebRtcTransport',
        {
          direction: 'send',
        },
      );
      await emitAsync(producerClient, 'connectWebRtcTransport', {
        transportId: sendTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      const produced = await emitAsync(producerClient, 'produce', {
        transportId: sendTransport.id,
        kind: 'audio',
        rtpParameters: audioProducerRtpParameters(rtpCapabilities, 33333333),
      });

      const client = await connectClient();
      await emitAsync(client, 'join', {
        roomId: 'no-recv-room',
        displayName: 'Grace',
      });
      // A send transport registers this peer in apps/sfu's MediaRoom (its
      // peers are created lazily per-transport, unlike realtime's Room,
      // whose Peer exists right after join) - without it, consume would 404
      // as "peer not found" rather than reaching the check this test targets.
      await emitAsync(client, 'createWebRtcTransport', { direction: 'send' });
      // no createWebRtcTransport({direction: 'recv'}) call: that's the point

      const { ack, exception } = await observeOutcome(client, 'consume', {
        producerId: produced.id,
        rtpCapabilities,
      });

      expect(ack).toBe('ACK_NOT_CALLED');
      expect(exception).toMatchObject({
        status: 'error',
        message: expect.stringContaining('has no recv transport'),
        cause: { pattern: 'consume' },
      });
    });

    it('regression: late joiner receives newProducer for pre-existing tracks', async () => {
      const alice = await connectClient();
      await emitAsync(alice, 'join', {
        roomId: 'late-joiner-room',
        displayName: 'Alice',
      });
      const rtpCapabilities = await emitAsync(
        alice,
        'getRouterRtpCapabilities',
      );
      const aliceSendTransport = await emitAsync(
        alice,
        'createWebRtcTransport',
        { direction: 'send' },
      );
      await emitAsync(alice, 'connectWebRtcTransport', {
        transportId: aliceSendTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      const produced = await emitAsync(alice, 'produce', {
        transportId: aliceSendTransport.id,
        kind: 'audio',
        rtpParameters: audioProducerRtpParameters(rtpCapabilities, 44444444),
      });

      // Bob joins after Alice already produced - only passes if join() backfills.
      const bob = await connectClient();
      const bobNewProducer = waitForEvent(bob, 'newProducer');
      const bobJoin = await emitAsync(bob, 'join', {
        roomId: 'late-joiner-room',
        displayName: 'Bob',
      });

      expect(bobJoin.existingPeers).toEqual([
        { id: alice.id, displayName: 'Alice' },
      ]);
      expect(await bobNewProducer).toEqual({
        peerId: alice.id,
        producerId: produced.id,
        kind: 'audio',
      });

      // The backfilled producer must be consumable exactly like a live one.
      const bobRecvTransport = await emitAsync(bob, 'createWebRtcTransport', {
        direction: 'recv',
      });
      await emitAsync(bob, 'connectWebRtcTransport', {
        transportId: bobRecvTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      const consumed = await emitAsync(bob, 'consume', {
        producerId: produced.id,
        rtpCapabilities,
      });
      expect(consumed).toMatchObject({
        id: expect.any(String),
        producerId: produced.id,
        kind: 'audio',
      });
    });

    it('regression: consume ack reports producerPaused for a producer paused before the consumer ever joined', async () => {
      const alice = await connectClient();
      await emitAsync(alice, 'join', {
        roomId: 'already-paused-room',
        displayName: 'Alice',
      });
      const rtpCapabilities = await emitAsync(
        alice,
        'getRouterRtpCapabilities',
      );
      const aliceSendTransport = await emitAsync(
        alice,
        'createWebRtcTransport',
        { direction: 'send' },
      );
      await emitAsync(alice, 'connectWebRtcTransport', {
        transportId: aliceSendTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      const produced = await emitAsync(alice, 'produce', {
        transportId: aliceSendTransport.id,
        kind: 'audio',
        rtpParameters: audioProducerRtpParameters(rtpCapabilities, 66666666),
      });

      // Alice pauses before Bob ever joins - producerPaused (the live
      // broadcast) never reaches Bob, so the consume ack is the only way
      // Bob can learn the producer started out paused.
      await emitAsync(alice, 'pauseProducer', { producerId: produced.id });

      const bob = await connectClient();
      await emitAsync(bob, 'join', {
        roomId: 'already-paused-room',
        displayName: 'Bob',
      });
      const bobRecvTransport = await emitAsync(bob, 'createWebRtcTransport', {
        direction: 'recv',
      });
      await emitAsync(bob, 'connectWebRtcTransport', {
        transportId: bobRecvTransport.id,
        dtlsParameters: fakeDtlsParameters(),
      });
      const consumed = await emitAsync(bob, 'consume', {
        producerId: produced.id,
        rtpCapabilities,
      });

      expect(consumed).toMatchObject({ producerPaused: true });
    });

    it('disconnecting without ever joining does not take the server down', async () => {
      const ghost = await connectClient();
      ghost.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 300));

      // if the server crashed above, this join would just time out
      const survivor = await connectClient();
      const join = await emitAsync(survivor, 'join', {
        roomId: 'survivor-room',
        displayName: 'Survivor',
      });

      expect(join).toEqual({ peerId: survivor.id, existingPeers: [] });
    });
  });

  describe('apps/sfu teardown on leave', () => {
    it('actually removes the peer in apps/sfu once it disconnects, not just in Redis', async () => {
      const alice = await connectClient();
      const roomId = 'sfu-teardown-room';
      const alicePeerId = alice.id!;

      await emitAsync(alice, 'join', { roomId, displayName: 'Alice' });
      await emitAsync(alice, 'createWebRtcTransport', { direction: 'send' });

      alice.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const mediaRoomsService = sfuApp.get(MediaRoomsService);
      expect(() => mediaRoomsService.getPeer(roomId, alicePeerId)).toThrow(
        NotFoundException,
      );
    });
  });

  describe('sessions', () => {
    it('pins a room to the configured sfu instance in Redis on first join, no other instances registered', async () => {
      const roomId = 'session-pin-room';
      const alice = await connectClient();

      await emitAsync(alice, 'join', { roomId, displayName: 'Alice' });

      const redis = app.get<Redis>(REDIS_CLIENT);
      expect(await redis.get(`session:${roomId}`)).toBe(sfuServiceUrl);
    });

    it('sessionHeartbeat acks and refreshes the session TTL', async () => {
      const roomId = 'heartbeat-room';
      const alice = await connectClient();
      await emitAsync(alice, 'join', { roomId, displayName: 'Alice' });

      const ack = await emitAsync(alice, 'sessionHeartbeat');

      expect(ack).toEqual({ ok: true });

      const redis = app.get<Redis>(REDIS_CLIENT);
      const ttl = await redis.ttl(`session:${roomId}`);
      expect(ttl).toBeGreaterThan(0);
    });

    it('sessionHeartbeat before joining never acks, only surfaces via the exception event', async () => {
      const client = await connectClient();

      const { ack, exception } = await observeOutcome(
        client,
        'sessionHeartbeat',
        undefined,
      );

      expect(ack).toBe('ACK_NOT_CALLED');
      expect(exception).toMatchObject({
        status: 'error',
        message: 'Socket has not joined a room yet',
        cause: { pattern: 'sessionHeartbeat' },
      });
    });
  });

  describe('chat over WS', () => {
    it('sends a chat message and reads it back from history, proving ChatGatewayModule is actually wired into AppModule', async () => {
      const alice = await connectClient();
      const roomId = 'chat-room';

      await emitAsync(alice, 'join', { roomId, displayName: 'Alice' });

      const chatMessage = waitForEvent(alice, 'chatMessage');
      const sendAck = await emitAsync(alice, 'sendChatMessage', {
        body: 'hello',
      });
      expect(sendAck).toEqual({ ok: true });
      await chatMessage;

      const history = await emitAsync(alice, 'getChatHistory', {});
      expect(history.messages).toEqual([
        expect.objectContaining({ peerId: alice.id, body: 'hello' }),
      ]);
    });
  });
});
