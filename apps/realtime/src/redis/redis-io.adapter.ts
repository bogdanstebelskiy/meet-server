import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { REDIS_CLIENT } from './redis.provider';

export class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly pubClient: Redis,
    private readonly subClient: Redis,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    const redisAdapter = createAdapter(this.pubClient, this.subClient);
    server.adapter(redisAdapter);
    return server;
  }
}

// Extracted so the DI lookup + duplicate() + wiring can be unit-tested
// directly, instead of only running as part of main.ts's untested bootstrap().
export function createRedisIoAdapter(
  app: INestApplicationContext,
): RedisIoAdapter {
  const logger = new Logger(RedisIoAdapter.name);
  const pubClient = app.get<Redis>(REDIS_CLIENT);
  const subClient = pubClient.duplicate();

  // ioredis treats an unhandled 'error' event as an uncaught exception and
  // crashes the process - both connections need a listener, since subClient
  // is a brand-new connection this adapter introduces.
  pubClient.on('error', (error) =>
    logger.error('Redis pub client error', error),
  );
  subClient.on('error', (error) =>
    logger.error('Redis sub client error', error),
  );

  return new RedisIoAdapter(app, pubClient, subClient);
}
