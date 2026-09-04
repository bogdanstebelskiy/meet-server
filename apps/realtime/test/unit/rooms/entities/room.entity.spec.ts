import { Room } from '../../../../src/rooms/entities/room.entity';
import { Peer } from '../../../../src/rooms/entities/peer.entity';

describe('Room', () => {
  const fakeRtpCapabilities = () => ({ codecs: [] }) as any;

  it('adds and removes peers, tracking isEmpty()', () => {
    const room = new Room('room-1', fakeRtpCapabilities());
    const peer = new Peer('peer-1', 'Alice');

    room.addPeer(peer);
    expect(room.peers.get('peer-1')).toBe(peer);
    expect(room.isEmpty()).toBe(false);

    room.removePeer('peer-1');
    expect(room.peers.has('peer-1')).toBe(false);
    expect(room.isEmpty()).toBe(true);
  });

  it('removePeer is a no-op for an unknown peer id, not a throw', () => {
    const room = new Room('room-1', fakeRtpCapabilities());

    expect(() => room.removePeer('missing')).not.toThrow();
  });

  it('getOtherPeers excludes the given peer id', () => {
    const room = new Room('room-1', fakeRtpCapabilities());
    const peer1 = new Peer('peer-1', 'Alice');
    const peer2 = new Peer('peer-2', 'Bob');
    room.addPeer(peer1);
    room.addPeer(peer2);

    expect(room.getOtherPeers('peer-1')).toEqual([peer2]);
  });

  it('getOtherPeers returns everyone when the given id is not in the room', () => {
    const room = new Room('room-1', fakeRtpCapabilities());
    const peer1 = new Peer('peer-1', 'Alice');
    room.addPeer(peer1);

    expect(room.getOtherPeers('never-joined')).toEqual([peer1]);
  });

  it('exposes the rtpCapabilities it was created with', () => {
    const rtpCapabilities = fakeRtpCapabilities();
    const room = new Room('room-1', rtpCapabilities);

    expect(room.rtpCapabilities).toBe(rtpCapabilities);
  });
});
