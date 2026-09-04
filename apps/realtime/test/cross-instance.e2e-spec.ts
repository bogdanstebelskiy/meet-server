import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type Redis from 'ioredis';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { AppModule as SfuAppModule } from '../../sfu/src/app.module';
import { REDIS_CLIENT } from '../src/redis/redis.provider';
import {
  createRedisIoAdapter,
  RedisIoAdapter,
} from '../src/redis/redis-io.adapter';

// Two real apps/realtime instances (plus one shared apps/sfu) over one
// shared Redis, proving #6's actual point: a peer connected to instance A
// sees events from a peer connected to instance B, via the redis-adapter
// (#22) and the Redis-backed RoomsService (#21) working together - neither
// half alone is provable from the single-instance suite in
// signaling.e2e-spec.ts. No real ICE/DTLS/RTP, same rationale as there.

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

describe('Cross-instance realtime scaling (e2e)', () => {
  let sfuApp: INestApplication;
  let instanceA: INestApplication;
  let instanceB: INestApplication;
  let adapterA: RedisIoAdapter;
  let adapterB: RedisIoAdapter;
  let baseUrlA: string;
  let baseUrlB: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const sfuModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [SfuAppModule],
    }).compile();

    sfuApp = sfuModuleFixture.createNestApplication();
    const sfuServiceUrl = await listenOnEphemeralPort(sfuApp);

    // Read by apps/realtime's SfuClientModule when each AppModule below
    // compiles - must be set first, shared by both instances.
    process.env.SFU_SERVICE_URL = sfuServiceUrl;

    const moduleA: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    instanceA = moduleA.createNestApplication();
    // The default in-memory socket.io adapter can't cross-broadcast between
    // two separate Nest apps - wire the same redis-adapter main.ts uses.
    adapterA = createRedisIoAdapter(instanceA);
    instanceA.useWebSocketAdapter(adapterA);
    baseUrlA = await listenOnEphemeralPort(instanceA);

    const moduleB: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    instanceB = moduleB.createNestApplication();
    adapterB = createRedisIoAdapter(instanceB);
    instanceB.useWebSocketAdapter(adapterB);
    baseUrlB = await listenOnEphemeralPort(instanceB);
  });

  afterAll(async () => {
    // Close apps before quitting Redis, so no straggling gateway handler
    // can still issue a command once the connection's gone.
    await instanceA.close();
    await instanceB.close();
    await sfuApp.close();

    // Each instance's DI container holds its own REDIS_CLIENT - app.close()
    // doesn't quit either, and left open they're handles that keep this
    // process from exiting.
    const redisA = instanceA.get<Redis>(REDIS_CLIENT);
    await redisA.quit();
    const redisB = instanceB.get<Redis>(REDIS_CLIENT);
    await redisB.quit();

    // Each adapter's subClient is a duplicate() connection nothing else
    // tracks - same leaked-handle problem as REDIS_CLIENT above.
    await (adapterA as unknown as { subClient: Redis }).subClient.quit();
    await (adapterB as unknown as { subClient: Redis }).subClient.quit();

    delete process.env.SFU_SERVICE_URL;
  });

  afterEach(async () => {
    clients.forEach((client) => client.disconnect());
    clients.length = 0;

    // disconnect() doesn't wait for the server's own leave()/Redis cleanup -
    // give it a moment so it can't race afterAll's teardown.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  function connectClient(baseUrl: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = io(baseUrl, {
        transports: ['websocket'],
        forceNew: true,
      });
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

  it('relays peer/producer join, backfill, and disconnect across two realtime instances', async () => {
    const alice = await connectClient(baseUrlA);
    const bob = await connectClient(baseUrlB);

    const aliceJoin = await emitAsync(alice, 'join', {
      roomId: 'cross-instance-room',
      displayName: 'Alice',
    });
    expect(aliceJoin).toEqual({ peerId: alice.id, existingPeers: [] });

    const aliceNewPeer = waitForEvent(alice, 'newPeer');
    const bobJoin = await emitAsync(bob, 'join', {
      roomId: 'cross-instance-room',
      displayName: 'Bob',
    });
    expect(bobJoin).toEqual({
      peerId: bob.id,
      existingPeers: [{ id: alice.id, displayName: 'Alice' }],
    });
    // Alice (instance A) only learns about Bob (instance B) via the
    // redis-adapter's cross-instance broadcast - this is #6's actual point.
    expect(await aliceNewPeer).toEqual({ id: bob.id, displayName: 'Bob' });

    const rtpCapabilities = await emitAsync(bob, 'getRouterRtpCapabilities');
    const bobSendTransport = await emitAsync(bob, 'createWebRtcTransport', {
      direction: 'send',
    });
    await emitAsync(bob, 'connectWebRtcTransport', {
      transportId: bobSendTransport.id,
      dtlsParameters: fakeDtlsParameters(),
    });

    const aliceNewProducer = waitForEvent(alice, 'newProducer');
    const produced = await emitAsync(bob, 'produce', {
      transportId: bobSendTransport.id,
      kind: 'audio',
      rtpParameters: audioProducerRtpParameters(rtpCapabilities, 77777777),
    });
    expect(await aliceNewProducer).toEqual({
      peerId: bob.id,
      producerId: produced.id,
      kind: 'audio',
    });

    // Carol joins late, back on instance A, and must be backfilled with
    // both existing peers and Bob's producer even though Bob is on instance B.
    const carol = await connectClient(baseUrlA);
    const carolNewProducer = waitForEvent(carol, 'newProducer');
    const carolJoin = await emitAsync(carol, 'join', {
      roomId: 'cross-instance-room',
      displayName: 'Carol',
    });
    expect(carolJoin.existingPeers).toEqual(
      expect.arrayContaining([
        { id: alice.id, displayName: 'Alice' },
        { id: bob.id, displayName: 'Bob' },
      ]),
    );
    expect(await carolNewProducer).toEqual({
      peerId: bob.id,
      producerId: produced.id,
      kind: 'audio',
    });

    const bobPeerId = bob.id;
    const alicePeerClosed = waitForEvent(alice, 'peerClosed');
    bob.disconnect();
    expect(await alicePeerClosed).toEqual({ peerId: bobPeerId });
  });
});
