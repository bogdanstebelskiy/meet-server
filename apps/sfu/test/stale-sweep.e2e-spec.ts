import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as crypto from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { StaleSweepConfigService } from '../src/stale-sweep/config/stale-sweep-config.service';

// Real NestJS app + real mediasoup workers + a real periodic setInterval
// sweep, driven by supertest over HTTP - the stale-sweep threshold/interval
// are overridden to tiny values just for this suite so the test doesn't
// have to wait out the real (multi-minute) default.

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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Stale MediaRoom sweep (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StaleSweepConfigService)
      .useValue({ thresholdMs: 100, sweepIntervalMs: 30 })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('force-closes a MediaRoom abandoned by a crashed realtime instance, releasing its peer/transport/producer, without any explicit closeRoom call', async () => {
    const roomId = 'abandoned-room';
    const peerId = 'alice';

    const room = await request(server).put(`/media-rooms/${roomId}`);
    const sendTransport = (
      await request(server)
        .post(`/media-rooms/${roomId}/peers/${peerId}/transports`)
        .send({ direction: 'send' })
    ).body;
    await request(server)
      .post(
        `/media-rooms/${roomId}/peers/${peerId}/transports/${sendTransport.id}/connect`,
      )
      .send({ dtlsParameters: fakeDtlsParameters() });
    const produced = (
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/transports/${sendTransport.id}/produce`,
        )
        .send({
          kind: 'audio',
          rtpParameters: {
            codecs: [
              {
                mimeType: 'audio/opus',
                payloadType: 111,
                clockRate: 48000,
                channels: 2,
                parameters: {},
                rtcpFeedback: [],
              },
            ],
            encodings: [{ ssrc: 99999999 }],
            rtcp: { cname: 'abandoned-cname' },
          },
        })
    ).body;

    // realtime never called removePeer/closeRoom for this room - alice
    // (and her transport/producer) are still listed, exactly like a crash.
    // A real closeRoom call right now must therefore report "not empty".
    const beforeSweep = await request(server).delete(`/media-rooms/${roomId}`);
    expect(beforeSweep.body).toEqual({ closed: false });

    // Let the real interval fire a few times past the tiny threshold above.
    await wait(500);

    // The room is gone even though nothing ever called removePeer/closeRoom -
    // every operation against alice's old peer/transport/producer 404s now.
    const pauseAfterSweep = await request(server)
      .post(
        `/media-rooms/${roomId}/peers/${peerId}/producers/${produced.id}/pause`,
      )
      .expect(404);
    expect(pauseAfterSweep.body.message).toContain(`MediaRoom ${roomId}`);

    // A later explicit closeRoom reports the room already gone, not "not empty".
    const afterSweep = await request(server).delete(`/media-rooms/${roomId}`);
    expect(afterSweep.body).toEqual({ closed: true });

    // The worker slot/router were actually released, not just orphaned - a
    // fresh room for the same id can be created and used from scratch.
    const recreated = await request(server)
      .put(`/media-rooms/${roomId}`)
      .expect(200);
    expect(recreated.body).toEqual(room.body);

    const freshTransport = await request(server)
      .post(`/media-rooms/${roomId}/peers/${peerId}/transports`)
      .send({ direction: 'send' })
      .expect(201);
    expect(freshTransport.body.id).toEqual(expect.any(String));
  });

  it('never closes a room kept alive by occasional REST activity, even past several sweep intervals', async () => {
    const roomId = 'busy-room';
    const peerId = 'bob';

    await request(server).put(`/media-rooms/${roomId}`);

    // Touch the room every 40ms (under the 100ms threshold) for a stretch
    // well longer than several sweep intervals (30ms) - it must survive.
    for (let i = 0; i < 8; i += 1) {
      await wait(40);
      await request(server).put(`/media-rooms/${roomId}`).expect(200);
    }

    const stillThere = await request(server)
      .post(`/media-rooms/${roomId}/peers/${peerId}/transports`)
      .send({ direction: 'send' })
      .expect(201);
    expect(stillThere.body.id).toEqual(expect.any(String));
  });
});
