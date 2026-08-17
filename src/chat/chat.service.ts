import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type { ChatMessage } from './types';

const HISTORY_LIMIT = 1000;

@Injectable()
export class ChatService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async addMessage(
    roomId: string,
    message: Omit<ChatMessage, 'id'>,
  ): Promise<ChatMessage> {
    const id = await this.redis.xadd(
      this.streamKey(roomId),
      'MAXLEN',
      '~',
      HISTORY_LIMIT,
      '*',
      'data',
      JSON.stringify(message),
    );

    return { ...message, id: id as string };
  }

  async getHistory(roomId: string): Promise<ChatMessage[]> {
    const entries = await this.redis.xrange(this.streamKey(roomId), '-', '+');

    return entries.map(([id, fields]) => ({
      id,
      ...(JSON.parse(fields[1]) as Omit<ChatMessage, 'id'>),
    }));
  }

  async deleteRoomHistory(roomId: string): Promise<void> {
    await this.redis.del(this.streamKey(roomId));
  }

  private streamKey(roomId: string): string {
    return `chat:${roomId}`;
  }
}
