import { Peer } from '../../../../src/rooms/entities/peer.entity';

describe('Peer', () => {
  it('stores id and displayName, starts with an empty producers map', () => {
    const peer = new Peer('peer-1', 'Alice');

    expect(peer.id).toBe('peer-1');
    expect(peer.displayName).toBe('Alice');
    expect(peer.producers.size).toBe(0);
  });
});
