import { Peer } from '../../../../src/rooms/entities/peer.entity';

describe('Peer', () => {
  it('stores id and displayName, starts with empty producer/consumer maps', () => {
    const peer = new Peer('peer-1', 'Alice');

    expect(peer.id).toBe('peer-1');
    expect(peer.displayName).toBe('Alice');
    expect(peer.producers.size).toBe(0);
    expect(peer.consumers.size).toBe(0);
    expect(peer.sendTransport).toBeUndefined();
    expect(peer.recvTransport).toBeUndefined();
  });

  it('close() is safe when no transports were ever created', () => {
    const peer = new Peer('peer-1', 'Alice');

    expect(() => peer.close()).not.toThrow();
  });

  it('close() closes both transports when present', () => {
    const peer = new Peer('peer-1', 'Alice');
    const sendTransport = { close: jest.fn() };
    const recvTransport = { close: jest.fn() };
    peer.sendTransport = sendTransport as any;
    peer.recvTransport = recvTransport as any;

    peer.close();

    expect(sendTransport.close).toHaveBeenCalledTimes(1);
    expect(recvTransport.close).toHaveBeenCalledTimes(1);
  });

  it('close() closes only the transport that exists (e.g. peer only ever sent)', () => {
    const peer = new Peer('peer-1', 'Alice');
    const sendTransport = { close: jest.fn() };
    peer.sendTransport = sendTransport as any;

    expect(() => peer.close()).not.toThrow();
    expect(sendTransport.close).toHaveBeenCalledTimes(1);
  });
});
