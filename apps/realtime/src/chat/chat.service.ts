import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.provider';
import { HISTORY_LIMIT } from './constants';
import type { ChatMessage } from './types';

@Injectable()
export class ChatService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async addMessage(
    roomId: string,
    message: Omit<ChatMessage, 'id'>,
  ): Promise<ChatMessage> {
    const streamKey = this.streamKey(roomId);
    const serializedMessage = JSON.stringify(message);
    const id = await this.redis.xadd(
      streamKey,
      'MAXLEN',
      '~',
      HISTORY_LIMIT,
      '*',
      'data',
      serializedMessage,
    );

    return { ...message, id: id as string };
  }

  async getHistory(roomId: string, afterId?: string): Promise<ChatMessage[]> {
    let start = '-';

    if (afterId) {
      start = `(${afterId}`;
    }

    const streamKey = this.streamKey(roomId);
    const entries = await this.redis.xrange(streamKey, start, '+');
    const messages = entries.map(([id, fields]) =>
      this.toChatMessage(id, fields),
    );

    return messages;
  }

  private toChatMessage(id: string, fields: string[]): ChatMessage {
    const data = fields[1];
    const message = JSON.parse(data) as Omit<ChatMessage, 'id'>;

    return { id, ...message };
  }

  async deleteRoomHistory(roomId: string): Promise<void> {
    const streamKey = this.streamKey(roomId);
    await this.redis.del(streamKey);
  }

  private streamKey(roomId: string): string {
    return `chat:${roomId}`;
  }
}
