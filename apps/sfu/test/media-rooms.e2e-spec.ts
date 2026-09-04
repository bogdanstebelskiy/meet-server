import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as crypto from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Real NestJS app + real mediasoup (no mocks), driven by supertest over
// HTTP. No real ICE/DTLS/RTP since there's no browser: dtlsParameters are
// fabricated, and connect/produce/consume are pure signaling RPCs that
// don't need real connectivity. Mirrors apps/realtime/test/signaling.e2e-spec.ts.

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

describe('MediaRooms (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('happy path', () => {
    it('walks create-room -> create-transport -> connect -> produce -> consume -> resume', async () => {
      const roomId = 'happy-room';
      const aliceId = 'alice';
      const bobId = 'bob';

      const roomResponse = await request(server)
        .put(`/media-rooms/${roomId}`)
        .expect(200);
      expect(roomResponse.body).toMatchObject({ roomId });
      const rtpCapabilities = roomResponse.body.rtpCapabilities;
      expect(
        rtpCapabilities.codecs.some((c: any) => c.mimeType === 'audio/opus'),
      ).toBe(true);

      const aliceSendTransport = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${aliceId}/transports`)
          .send({ direction: 'send' })
          .expect(201)
      ).body;
      expect(aliceSendTransport).toMatchObject({
        id: expect.any(String),
        iceParameters: expect.any(Object),
        iceCandidates: expect.any(Array),
        dtlsParameters: expect.any(Object),
      });

      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${aliceId}/transports/${aliceSendTransport.id}/connect`,
        )
        .send({ dtlsParameters: fakeDtlsParameters() })
        .expect(200)
        .expect({ connected: true });

      const bobRecvTransport = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${bobId}/transports`)
          .send({ direction: 'recv' })
          .expect(201)
      ).body;
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${bobId}/transports/${bobRecvTransport.id}/connect`,
        )
        .send({ dtlsParameters: fakeDtlsParameters() })
        .expect(200);

      const produced = (
        await request(server)
          .post(
            `/media-rooms/${roomId}/peers/${aliceId}/transports/${aliceSendTransport.id}/produce`,
          )
          .send({
            kind: 'audio',
            rtpParameters: audioProducerRtpParameters(
              rtpCapabilities,
              11111111,
            ),
          })
          .expect(201)
      ).body;
      expect(produced).toEqual({ id: expect.any(String) });

      const consumed = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${bobId}/consumers`)
          .send({ producerId: produced.id, rtpCapabilities })
          .expect(201)
      ).body;
      expect(consumed).toMatchObject({
        id: expect.any(String),
        producerId: produced.id,
        kind: 'audio',
        rtpParameters: expect.any(Object),
        producerPaused: false,
      });

      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${bobId}/consumers/${consumed.id}/resume`,
        )
        .expect(200)
        .expect({ resumed: true });
    });

    it('is idempotent: repeated create-or-get for the same roomId returns the same rtpCapabilities without a second router', async () => {
      const roomId = 'idempotent-room';

      const first = await request(server)
        .put(`/media-rooms/${roomId}`)
        .expect(200);
      const second = await request(server)
        .put(`/media-rooms/${roomId}`)
        .expect(200);

      expect(second.body).toEqual(first.body);
    });

    it('dedupes concurrent create-or-get calls for a brand-new roomId into one shared room', async () => {
      const roomId = 'race-room';
      const peerId = 'racer';

      const [first, second] = await Promise.all([
        request(server).put(`/media-rooms/${roomId}`),
        request(server).put(`/media-rooms/${roomId}`),
      ]);

      expect(first.body).toEqual(second.body);

      // Confirms both requests share one router: producing on it and
      // consuming from a fresh peer only works if there's a single room.
      const rtpCapabilities = first.body.rtpCapabilities;
      const sendTransport = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${peerId}/transports`)
          .send({ direction: 'send' })
          .expect(201)
      ).body;
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/transports/${sendTransport.id}/connect`,
        )
        .send({ dtlsParameters: fakeDtlsParameters() })
        .expect(200);
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/transports/${sendTransport.id}/produce`,
        )
        .send({
          kind: 'audio',
          rtpParameters: audioProducerRtpParameters(rtpCapabilities, 22222222),
        })
        .expect(201);
    });

    it('pauses and resumes a producer', async () => {
      const roomId = 'pause-room';
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
            rtpParameters: audioProducerRtpParameters(
              room.body.rtpCapabilities,
              33333333,
            ),
          })
      ).body;

      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/producers/${produced.id}/pause`,
        )
        .expect(200)
        .expect({ paused: true });

      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/producers/${produced.id}/resume`,
        )
        .expect(200)
        .expect({ resumed: true });
    });
  });

  describe('errors', () => {
    it('creating a transport in an unknown room returns a standard NotFoundException JSON body', async () => {
      const response = await request(server)
        .post('/media-rooms/no-such-room/peers/ghost/transports')
        .send({ direction: 'send' })
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        message: expect.stringContaining('no-such-room'),
        error: 'Not Found',
      });
    });

    it('producing with a mismatched transportId returns 404', async () => {
      const roomId = 'mismatch-room';
      const peerId = 'frank';
      await request(server).put(`/media-rooms/${roomId}`);
      await request(server)
        .post(`/media-rooms/${roomId}/peers/${peerId}/transports`)
        .send({ direction: 'send' });

      const response = await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${peerId}/transports/does-not-exist/produce`,
        )
        .send({ kind: 'audio', rtpParameters: {} })
        .expect(404);

      expect(response.body.message).toContain('not found for peer');
    });

    it('consuming before ever creating a recv transport returns 404', async () => {
      const roomId = 'no-recv-room';
      const producerId = 'producer-peer';
      const room = await request(server).put(`/media-rooms/${roomId}`);
      const sendTransport = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${producerId}/transports`)
          .send({ direction: 'send' })
      ).body;
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${producerId}/transports/${sendTransport.id}/connect`,
        )
        .send({ dtlsParameters: fakeDtlsParameters() });
      const produced = (
        await request(server)
          .post(
            `/media-rooms/${roomId}/peers/${producerId}/transports/${sendTransport.id}/produce`,
          )
          .send({
            kind: 'audio',
            rtpParameters: audioProducerRtpParameters(
              room.body.rtpCapabilities,
              44444444,
            ),
          })
      ).body;

      // Registers the consumer peer via a send transport, deliberately
      // never creating a recv transport - the point of this test.
      const consumerId = 'consumer-peer';
      await request(server)
        .post(`/media-rooms/${roomId}/peers/${consumerId}/transports`)
        .send({ direction: 'send' });

      const response = await request(server)
        .post(`/media-rooms/${roomId}/peers/${consumerId}/consumers`)
        .send({
          producerId: produced.id,
          rtpCapabilities: room.body.rtpCapabilities,
        })
        .expect(404);

      expect(response.body.message).toContain('has no recv transport');
    });
  });

  describe('teardown', () => {
    it('removing a peer closes its transports, and only the last peer removal allows the room to close', async () => {
      const roomId = 'teardown-room';
      const aliceId = 'alice';
      const bobId = 'bob';

      const room = await request(server).put(`/media-rooms/${roomId}`);
      const aliceSendTransport = (
        await request(server)
          .post(`/media-rooms/${roomId}/peers/${aliceId}/transports`)
          .send({ direction: 'send' })
      ).body;
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${aliceId}/transports/${aliceSendTransport.id}/connect`,
        )
        .send({ dtlsParameters: fakeDtlsParameters() });
      await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${aliceId}/transports/${aliceSendTransport.id}/produce`,
        )
        .send({
          kind: 'audio',
          rtpParameters: audioProducerRtpParameters(
            room.body.rtpCapabilities,
            55555555,
          ),
        });
      await request(server)
        .post(`/media-rooms/${roomId}/peers/${bobId}/transports`)
        .send({ direction: 'recv' });

      await request(server)
        .delete(`/media-rooms/${roomId}/peers/${aliceId}`)
        .expect(200)
        .expect({ removed: true });

      // Alice herself (and her transport with her) is gone from the room.
      const afterRemoval = await request(server)
        .post(
          `/media-rooms/${roomId}/peers/${aliceId}/transports/${aliceSendTransport.id}/produce`,
        )
        .send({
          kind: 'audio',
          rtpParameters: audioProducerRtpParameters(
            room.body.rtpCapabilities,
            66666666,
          ),
        })
        .expect(404);
      expect(afterRemoval.body.message).toContain(`Peer ${aliceId} not found`);

      // Bob still remains, so the router must not be closed yet.
      const stillOpen = await request(server)
        .delete(`/media-rooms/${roomId}`)
        .expect(200);
      expect(stillOpen.body).toEqual({ closed: false });
      await request(server)
        .put(`/media-rooms/${roomId}`)
        .expect(200)
        .expect(room.body);

      await request(server)
        .delete(`/media-rooms/${roomId}/peers/${bobId}`)
        .expect(200)
        .expect({ removed: true });

      const closed = await request(server)
        .delete(`/media-rooms/${roomId}`)
        .expect(200);
      expect(closed.body).toEqual({ closed: true });

      // The router is gone, so create-or-get spins up a brand new room.
      const recreated = await request(server)
        .put(`/media-rooms/${roomId}`)
        .expect(200);
      expect(recreated.body.roomId).toBe(roomId);
    });

    it('removing a peer from an unknown room returns a standard NotFoundException JSON body', async () => {
      const response = await request(server)
        .delete('/media-rooms/no-such-room/peers/ghost')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        message: expect.stringContaining('no-such-room'),
        error: 'Not Found',
      });
    });

    it('closing an unknown room returns a standard NotFoundException JSON body', async () => {
      const response = await request(server)
        .delete('/media-rooms/no-such-room')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        message: expect.stringContaining('no-such-room'),
        error: 'Not Found',
      });
    });
  });
});
