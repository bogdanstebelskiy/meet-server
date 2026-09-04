import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  RedisIoAdapter,
  createRedisIoAdapter,
} from '../../../src/redis/redis-io.adapter';
import { REDIS_CLIENT } from '../../../src/redis/redis.provider';

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(),
}));

describe('RedisIoAdapter', () => {
  it('attaches a redis adapter built from the pub/sub clients to the socket.io server', () => {
    const fakeServer = { adapter: jest.fn() };
    const createIOServerSpy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue(fakeServer);

    const fakeRedisAdapterConstructor = jest.fn();
    (createAdapter as jest.Mock).mockReturnValue(fakeRedisAdapterConstructor);

    const pubClient = {} as never;
    const subClient = {} as never;
    const app = {} as never;
    const adapter = new RedisIoAdapter(app, pubClient, subClient);

    const server = adapter.createIOServer(0);

    expect(createIOServerSpy).toHaveBeenCalledWith(0, undefined);
    expect(createAdapter).toHaveBeenCalledWith(pubClient, subClient);
    expect(fakeServer.adapter).toHaveBeenCalledWith(
      fakeRedisAdapterConstructor,
    );
    expect(server).toBe(fakeServer);

    createIOServerSpy.mockRestore();
  });
});

describe('createRedisIoAdapter', () => {
  function fakeApp(pubClient: unknown) {
    const get = jest.fn().mockReturnValue(pubClient);
    return { get };
  }

  it('looks up REDIS_CLIENT, duplicates it for the sub client, and registers error listeners on both', () => {
    const subClient = { on: jest.fn() };
    const pubClient = {
      on: jest.fn(),
      duplicate: jest.fn().mockReturnValue(subClient),
    };
    const app = fakeApp(pubClient);

    const adapter = createRedisIoAdapter(
      app as unknown as INestApplicationContext,
    );

    expect(app.get).toHaveBeenCalledWith(REDIS_CLIENT);
    expect(pubClient.duplicate).toHaveBeenCalled();
    expect(pubClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(subClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(adapter).toBeInstanceOf(RedisIoAdapter);
  });

  it('wires the looked-up pub/sub clients into the redis adapter used by the socket.io server', () => {
    const fakeServer = { adapter: jest.fn() };
    const createIOServerSpy = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue(fakeServer);

    const subClient = { on: jest.fn() };
    const pubClient = {
      on: jest.fn(),
      duplicate: jest.fn().mockReturnValue(subClient),
    };
    const app = fakeApp(pubClient);

    const adapter = createRedisIoAdapter(
      app as unknown as INestApplicationContext,
    );
    adapter.createIOServer(0);

    expect(createAdapter).toHaveBeenCalledWith(pubClient, subClient);

    createIOServerSpy.mockRestore();
  });
});
