import { BroadcastService } from '../../../src/broadcast/broadcast.service';

describe('BroadcastService', () => {
  let service: BroadcastService;

  beforeEach(() => {
    service = new BroadcastService();
  });

  it('does nothing when no server has been set yet', () => {
    expect(() =>
      service.broadcastToRoom('room-1', 'roomRecovered', { roomId: 'room-1' }),
    ).not.toThrow();
  });

  it('emits the event to the room via the server set through setServer', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const server = { to } as any;

    service.setServer(server);
    service.broadcastToRoom('room-1', 'roomRecovered', { roomId: 'room-1' });

    expect(to).toHaveBeenCalledWith('room-1');
    expect(emit).toHaveBeenCalledWith('roomRecovered', { roomId: 'room-1' });
  });
});
