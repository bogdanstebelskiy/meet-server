import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { extractSocketContext } from '../../../../src/signaling/decorators/socket-context.decorator';

describe('extractSocketContext', () => {
  const createContext = (data: Record<string, unknown>): ExecutionContext => {
    const client = { data };

    return {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;
  };

  it('returns roomId/peerId once both are set on the socket', () => {
    const context = createContext({ roomId: 'room-1', peerId: 'peer-1' });

    expect(extractSocketContext(context)).toEqual({
      roomId: 'room-1',
      peerId: 'peer-1',
    });
  });

  it('throws WsException when the socket never joined a room', () => {
    const context = createContext({});

    expect(() => extractSocketContext(context)).toThrow(WsException);
  });

  it('throws WsException when only roomId is set (partial/corrupt state)', () => {
    const context = createContext({ roomId: 'room-1' });

    expect(() => extractSocketContext(context)).toThrow(WsException);
  });

  it('throws WsException when only peerId is set (partial/corrupt state)', () => {
    const context = createContext({ peerId: 'peer-1' });

    expect(() => extractSocketContext(context)).toThrow(WsException);
  });
});
