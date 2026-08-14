import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

// Real NestJS app + real mediasoup (no mocks), driven by real socket.io
// clients. No real ICE/DTLS/RTP since there's no browser: dtlsParameters are
// fabricated, and connectWebRtcTransport/produce/consume are pure signaling
// RPCs that don't need real connectivity. See docs/sfu-signaling-design.md
// for the two bugs this suite found and now regression-tests as fixed.

jest.setTimeout(20000);

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
  let app: INestApplication;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    clients.forEach((client) => client.disconnect());
    clients.length = 0;
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
});
